const BASH_ZSH = `
# gwt shell integration
gwt() {
  if [[ "$1" == "cd" ]]; then
    local dir
    dir="$(command gwt cd "\${@:2}")" && cd "$dir"
  else
    command gwt "$@"
  fi
}
`.trim();

const FISH = `
# gwt shell integration
function gwt
  if test "$argv[1]" = "cd"
    set -l dir (command gwt cd $argv[2..])
    and cd $dir
  else
    command gwt $argv
  end
end
`.trim();

export function shell(shellType?: string): void {
  const detected = shellType ?? detectShell();

  switch (detected) {
    case "fish":
      console.log(FISH);
      break;
    case "bash":
    case "zsh":
    default:
      console.log(BASH_ZSH);
      break;
  }
}

function detectShell(): string {
  const shellEnv = process.env.SHELL ?? "";
  if (shellEnv.includes("fish")) return "fish";
  if (shellEnv.includes("zsh")) return "zsh";
  return "bash";
}
