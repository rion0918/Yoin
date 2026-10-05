{
  description = "Yoin – Expo / React Native development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        mkDevShell = if pkgs.stdenv.isDarwin then pkgs.mkShellNoCC else pkgs.mkShell;
        androidSdk = if pkgs.stdenv.isDarwin then "$HOME/Library/Android/sdk" else "$HOME/Android/Sdk";
      in
      {
        formatter = pkgs.nixfmt;

        devShells.default = mkDevShell {
          packages = with pkgs; [
            nodejs_24
            openjdk17
            ffmpeg
            actionlint
            shellcheck
          ];

          shellHook = ''
            export JAVA_HOME=${pkgs.openjdk17}
            export ANDROID_HOME="''${ANDROID_HOME:-${androidSdk}}"
            export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
          '';
        };
      }
    );
}
