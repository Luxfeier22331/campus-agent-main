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
          lightPackages = with pkgs; [
            actionlint
            gh
            gitMinimal
            gitleaks
            jq
            nodejs_24
            pnpm_10
            python312
            ripgrep
            shellcheck
            tools.osvScanner
            tools.uv
            tools.zizmor
          ];
          fullPackages =
            lightPackages
            ++ (with pkgs; [
              cargo
              clippy
              docker-buildx
              docker-client
              go_1_26
              golangci-lint
              kubectl
              rustc
              rustfmt
              trivy
              tools.conftest
              tools.kustomize
            ]);
          ciLight = pkgs.mkShellNoCC { packages = lightPackages; };
          ciFull = pkgs.mkShellNoCC { packages = fullPackages; };
        in
        assert pkgs.nodejs_24.version == nodeVersion;
        assert pkgs.pnpm_10.version == pnpmVersion;
        assert pkgs.go_1_26.version == "1.26.5";
        assert pkgs.golangci-lint.version == "2.12.2";
        assert pkgs.rustc.version == rustToolchain.toolchain.channel;
        assert pkgs.trivy.version == "0.72.0";
        {
          ci-light = ciLight;
          ci-full = ciFull;
          default = ciFull;
        }
      );
    };
}
