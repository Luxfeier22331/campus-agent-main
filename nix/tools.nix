{ pkgs }:

let
  inherit (pkgs) lib stdenvNoCC;
  platform =
    if pkgs.stdenv.hostPlatform.isx86_64 then
      "x86_64"
    else if pkgs.stdenv.hostPlatform.isAarch64 then
      "aarch64"
    else
      throw "Unsupported source toolchain system: ${pkgs.stdenv.hostPlatform.system}";
  release =
    {
      x86_64 = {
        nodeArch = "x64";
        nodeHash = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6";
        conftestArch = "x86_64";
        conftestHash = "sha256-lvwvvxHwr95RJWZHEn5vAKZM6Dmk2aChrvJCbA5vSz8=";
        kustomizeArch = "amd64";
        kustomizeHash = "sha256-App/D04ZMsUqBHbPAqD9hVwLuFaUuCwzj8ZI3LU6gZ0=";
        osvArch = "amd64";
        osvHash = "sha256-7c/EHSV9s2FI8GUFVlX+P8/ENLC0I+pnRoqEwgdSTgw=";
        uvArch = "x86_64";
        uvHash = "sha256-YAz5p0KsoA0pJnOxa1rP+qe4wmmjZK0MLnlJjcsf4QE=";
        zizmorArch = "x86_64";
        zizmorHash = "sha256-3ZbfBEpuhTjV9CN5D0U73QPUnlsrzDghSsxBovEpeDk=";
      };
      aarch64 = {
        nodeArch = "arm64";
        nodeHash = "6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2";
        conftestArch = "arm64";
        conftestHash = "sha256-O5w1Ij/jX5mI4VPN/7AUT5ESATBsdGdYtzvoKDHFQ9k=";
        kustomizeArch = "arm64";
        kustomizeHash = "sha256-CVPqPkdvZtbd/NkR11D1FnuTZaqUkbIyY5jiif7ywUI=";
        osvArch = "arm64";
        osvHash = "sha256-/hUuGlRq8iPmxVfMMRGouz5dwC/L99vpXSZWfA8AQfI=";
        uvArch = "aarch64";
        uvHash = "sha256-u2bLUuexgjrtEYNjDY2OXJWIQNWEpMVewQpM/BaNzKI=";
        zizmorArch = "aarch64";
        zizmorHash = "sha256-QV6qfAoGR5pwG45Eo+gSwQR97MhI7Evt571rv0nyLSA=";
      };
    }
    .${platform};
  supportedPlatforms = [
    "aarch64-linux"
    "x86_64-linux"
  ];
in
rec {
  # Remove this compatibility patch once upstream validates concurrency.queue.
  actionlint = pkgs.actionlint.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ ./actionlint-concurrency-queue.patch ];
    doInstallCheck = true;
    postInstallCheck = (old.postInstallCheck or "") + ''
      for queue in single max; do
        printf 'on: push\nconcurrency:\n  group: release\n  queue: %s\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' "$queue" > queue.yml
        "$out/bin/actionlint" -shellcheck= -pyflakes= queue.yml
      done
      sed 's/queue: max/queue: invalid/' queue.yml > invalid.yml
      if "$out/bin/actionlint" -shellcheck= -pyflakes= invalid.yml; then exit 1; fi
      sed '/queue: max/a\  cancel-in-progress: true' queue.yml > invalid.yml
      if "$out/bin/actionlint" -shellcheck= -pyflakes= invalid.yml; then exit 1; fi
    '';
  });

  # Use the official binary while nixpkgs lags the repository Node version.
  # Return to nixpkgs when the matching version has Linux binary substitutes.
  nodejs = stdenvNoCC.mkDerivation rec {
    pname = "nodejs";
    version = lib.removeSuffix "\n" (builtins.readFile ../.node-version);
    src = pkgs.fetchurl {
      url = "https://nodejs.org/dist/v${version}/node-v${version}-linux-${release.nodeArch}.tar.xz";
      sha256 = release.nodeHash;
    };
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    dontBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r bin lib include share "$out/"
      runHook postInstall
    '';
    doInstallCheck = true;
    installCheckPhase = ''
      test "$("$out/bin/node" --version)" = "v${version}"
    '';
    meta = {
      description = "Official Node.js binary";
      homepage = "https://nodejs.org/";
      license = lib.licenses.mit;
      mainProgram = "node";
      platforms = supportedPlatforms;
    };
  };

  conftest = stdenvNoCC.mkDerivation rec {
    pname = "conftest";
    version = "0.69.0";
    src = pkgs.fetchurl {
      url = "https://github.com/open-policy-agent/conftest/releases/download/v${version}/conftest_${version}_Linux_${release.conftestArch}.tar.gz";
      hash = release.conftestHash;
    };
    sourceRoot = ".";
    installPhase = ''
      runHook preInstall
      install -Dm755 conftest "$out/bin/conftest"
      runHook postInstall
    '';
    meta = {
      description = "Test structured configuration data using Open Policy Agent";
      homepage = "https://www.conftest.dev/";
      license = lib.licenses.asl20;
      mainProgram = "conftest";
      platforms = supportedPlatforms;
    };
  };

  kustomize = stdenvNoCC.mkDerivation rec {
    pname = "kustomize";
    version = "5.8.1";
    src = pkgs.fetchurl {
      url = "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v${version}/kustomize_v${version}_linux_${release.kustomizeArch}.tar.gz";
      hash = release.kustomizeHash;
    };
    sourceRoot = ".";
    installPhase = ''
      runHook preInstall
      install -Dm755 kustomize "$out/bin/kustomize"
      runHook postInstall
    '';
    meta = {
      description = "Template-free Kubernetes configuration customization";
      homepage = "https://kubectl.docs.kubernetes.io/";
      license = lib.licenses.asl20;
      mainProgram = "kustomize";
      platforms = supportedPlatforms;
    };
  };

  osvScanner = stdenvNoCC.mkDerivation rec {
    pname = "osv-scanner";
    version = "2.5.0";
    src = pkgs.fetchurl {
      url = "https://github.com/google/osv-scanner/releases/download/v${version}/osv-scanner_linux_${release.osvArch}";
      hash = release.osvHash;
    };
    dontUnpack = true;
    installPhase = ''
      runHook preInstall
      install -Dm755 "$src" "$out/bin/osv-scanner"
      runHook postInstall
    '';
    meta = {
      description = "Vulnerability scanner using the OSV database";
      homepage = "https://google.github.io/osv-scanner/";
      license = lib.licenses.asl20;
      mainProgram = "osv-scanner";
      platforms = supportedPlatforms;
    };
  };

  uv = stdenvNoCC.mkDerivation rec {
    pname = "uv";
    version = "0.12.3";
    src = pkgs.fetchurl {
      url = "https://github.com/astral-sh/uv/releases/download/${version}/uv-${release.uvArch}-unknown-linux-gnu.tar.gz";
      hash = release.uvHash;
    };
    sourceRoot = "uv-${release.uvArch}-unknown-linux-gnu";
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    installPhase = ''
      runHook preInstall
      install -Dm755 uv uvx -t "$out/bin"
      runHook postInstall
    '';
    meta = {
      description = "Python package and project manager";
      homepage = "https://docs.astral.sh/uv/";
      license = lib.licenses.asl20;
      mainProgram = "uv";
      platforms = supportedPlatforms;
    };
  };

  zizmor = stdenvNoCC.mkDerivation rec {
    pname = "zizmor";
    version = "1.29.0";
    src = pkgs.fetchurl {
      url = "https://github.com/zizmorcore/zizmor/releases/download/v${version}/zizmor-${release.zizmorArch}-unknown-linux-gnu.tar.gz";
      hash = release.zizmorHash;
    };
    sourceRoot = ".";
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    installPhase = ''
      runHook preInstall
      install -Dm755 zizmor "$out/bin/zizmor"
      runHook postInstall
    '';
    meta = {
      description = "Static analysis for GitHub Actions";
      homepage = "https://docs.zizmor.sh/";
      license = lib.licenses.mit;
      mainProgram = "zizmor";
      platforms = supportedPlatforms;
    };
  };
}
