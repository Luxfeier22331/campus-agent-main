{
  description = "campus-agent source toolchain";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        import ./nix/tools.nix { inherit pkgs; }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          nodeVersion = nixpkgs.lib.removeSuffix "\n" (builtins.readFile ./.node-version);
          packageJson = builtins.fromJSON (builtins.readFile ./package.json);
          pnpmVersion = nixpkgs.lib.removePrefix "pnpm@" packageJson.packageManager;
          tools = import ./nix/tools.nix { inherit pkgs; };
          goModLines = pkgs.lib.splitString "\n" (builtins.readFile ./apps/execution-control/go.mod);
          goLanguageDirective = pkgs.lib.findFirst (line: pkgs.lib.hasPrefix "go " line) null goModLines;
          goToolchainDirective = pkgs.lib.findFirst (line: pkgs.lib.hasPrefix "toolchain go" line) null goModLines;
          goLanguageMatch =
            if goLanguageDirective == null then
              throw "apps/execution-control/go.mod must declare a go language version"
            else
              builtins.match "go ([0-9]+)[.]([0-9]+)" goLanguageDirective;
          goToolchainMatch =
            if goToolchainDirective == null then
              throw "apps/execution-control/go.mod must declare a toolchain version"
            else
              builtins.match "toolchain go([0-9]+)[.]([0-9]+)[.]([0-9]+)" goToolchainDirective;
          goLanguageMajor =
            if goLanguageMatch == null then
              throw "apps/execution-control/go.mod has an invalid go language directive"
            else
              builtins.elemAt goLanguageMatch 0;
          goLanguageMinor = builtins.elemAt goLanguageMatch 1;
          goToolchainMajor =
            if goToolchainMatch == null then
              throw "apps/execution-control/go.mod has an invalid toolchain directive"
            else
              builtins.elemAt goToolchainMatch 0;
          goToolchainMinor = builtins.elemAt goToolchainMatch 1;
          goToolchainPatch = builtins.elemAt goToolchainMatch 2;
          goToolchainVersion = "${goToolchainMajor}.${goToolchainMinor}.${goToolchainPatch}";
          goPackageAttribute = "go_${goLanguageMajor}_${goLanguageMinor}";
          goBaseToolchain =
            if goLanguageMajor != goToolchainMajor || goLanguageMinor != goToolchainMinor then
              throw "apps/execution-control/go.mod go and toolchain versions must share major/minor"
            else if builtins.hasAttr goPackageAttribute pkgs then
              builtins.getAttr goPackageAttribute pkgs
            else
              throw "nixpkgs does not provide ${goPackageAttribute}";
          goToolchain = goBaseToolchain.overrideAttrs (_: {
            version = goToolchainVersion;
            src = pkgs.fetchurl {
              url = "https://go.dev/dl/go${goToolchainVersion}.src.tar.gz";
              hash = "sha256-oHIcVMaIkBRI13rZs+x+p8R0cwdV/4kTgukuy5P/LLE=";
            };
          });
          corePackages = with pkgs; [
            gh
            gitMinimal
            gitleaks
            jq
            nodejs_24
            pnpm_11
            ripgrep
          ];
          lightPackages = corePackages ++ (with pkgs; [
            actionlint
            python312
            shellcheck
            tools.osvScanner
            tools.uv
            tools.zizmor
          ]);
          containerPackages = with pkgs; [
            docker-buildx
            docker-client
            trivy
          ];
          releasePackages = corePackages ++ containerPackages;
          fullPackages = lightPackages ++ containerPackages ++ (with pkgs; [
            golangci-lint
            kubectl
            tools.conftest
            tools.kustomize
          ]) ++ [ goToolchain ];
          ciCore = pkgs.mkShellNoCC { packages = corePackages; };
          ciLight = pkgs.mkShellNoCC { packages = lightPackages; };
          ciRelease = pkgs.mkShellNoCC { packages = releasePackages; };
          ciFull = pkgs.mkShellNoCC {
            packages = fullPackages;
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
          };
        in
        assert pkgs.nodejs_24.version == nodeVersion;
        assert pkgs.pnpm_11.version == pnpmVersion;
        assert pkgs.golangci-lint.version == "2.12.2";
        assert pkgs.trivy.version == "0.73.0";
        {
          ci-core = ciCore;
          ci-light = ciLight;
          ci-release = ciRelease;
          ci-full = ciFull;
          default = ciCore;
        }
      );
    };
}
