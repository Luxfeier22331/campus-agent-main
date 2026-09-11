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
          pnpmToolchain = pkgs.pnpm_11.override { nodejs-slim = tools.nodejs; };
          goModLines = pkgs.lib.splitString "\n" (builtins.readFile ./go.work);
          goLanguageDirective = pkgs.lib.findFirst (line: pkgs.lib.hasPrefix "go " line) null goModLines;
          goToolchainDirective = pkgs.lib.findFirst (line: pkgs.lib.hasPrefix "toolchain go" line) null goModLines;
          goLanguageMatch =
            if goLanguageDirective == null then
              throw "go.work must declare a go language version"
            else
              builtins.match "go ([0-9]+)[.]([0-9]+)" goLanguageDirective;
          goToolchainMatch =
            if goToolchainDirective == null then
              throw "go.work must declare a toolchain version"
            else
              builtins.match "toolchain go([0-9]+)[.]([0-9]+)[.]([0-9]+)" goToolchainDirective;
          goLanguageMajor =
            if goLanguageMatch == null then
              throw "go.work has an invalid go language directive"
            else
              builtins.elemAt goLanguageMatch 0;
          goLanguageMinor = builtins.elemAt goLanguageMatch 1;
          goToolchainMajor =
            if goToolchainMatch == null then
              throw "go.work has an invalid toolchain directive"
            else
              builtins.elemAt goToolchainMatch 0;
          goToolchainMinor = builtins.elemAt goToolchainMatch 1;
          goToolchainPatch = builtins.elemAt goToolchainMatch 2;
          goToolchainVersion = "${goToolchainMajor}.${goToolchainMinor}.${goToolchainPatch}";
          goPackageAttribute = "go_${goLanguageMajor}_${goLanguageMinor}";
          goToolchain =
            if goLanguageMajor != goToolchainMajor || goLanguageMinor != goToolchainMinor then
              throw "go.work go and toolchain versions must share major/minor"
            else if builtins.hasAttr goPackageAttribute pkgs then
              builtins.getAttr goPackageAttribute pkgs
            else
              throw "nixpkgs does not provide ${goPackageAttribute}";
          corePackages = with pkgs; [
            gh
            gitMinimal
            gitleaks
            jq
            tools.nodejs
            pnpmToolchain
            ripgrep
          ];
          lightPackages = corePackages ++ (with pkgs; [
            actionlint
            editorconfig-checker
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
          ciFormat = pkgs.mkShellNoCC {
            packages = [ goToolchain pkgs.golangci-lint ];
            GOTOOLCHAIN = "local";
          };
          ciGo = pkgs.mkShellNoCC {
            GOTOOLCHAIN = "local";
            packages = corePackages ++ [ goToolchain pkgs.golangci-lint ];
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
          };
          ciFull = pkgs.mkShellNoCC {
            GOTOOLCHAIN = "local";
            packages = fullPackages;
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
          };
        in
        assert goToolchain.version == goToolchainVersion;
        assert tools.nodejs.version == nodeVersion;
        assert pnpmToolchain.version == pnpmVersion;
        assert pkgs.golangci-lint.version == "2.13.2";
        assert pkgs.trivy.version == "0.74.0";
        {
          ci-core = ciCore;
          ci-light = ciLight;
          ci-release = ciRelease;
          ci-format = ciFormat;
          ci-go = ciGo;
          ci-full = ciFull;
          default = ciCore;
        }
      );
    };
}
