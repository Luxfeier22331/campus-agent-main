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
          rustToolchain = builtins.fromTOML (builtins.readFile ./rust-toolchain.toml);
          tools = import ./nix/tools.nix { inherit pkgs; };
          goToolchain = pkgs.go_1_26.overrideAttrs (_: {
            version = "1.26.6";
            src = pkgs.fetchurl {
              url = "https://go.dev/dl/go1.26.6.src.tar.gz";
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
            cargo
            clippy
            golangci-lint
            kubectl
            rustc
            rustfmt
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
        assert goToolchain.version == "1.26.6";
        assert pkgs.golangci-lint.version == "2.12.2";
        assert pkgs.rustc.version == rustToolchain.toolchain.channel;
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
