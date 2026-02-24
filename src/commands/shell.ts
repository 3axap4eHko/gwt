const SUBCOMMANDS = "clone init add rm list ls lock unlock move cd edit run sync pr mr shell install update";
const WT_COMMANDS = "cd edit rm sync pr mr lock unlock move run";

const BASH_ZSH = `
# gwt shell integration
gwt() {
  if [[ "$1" == "cd" || "$1" == "edit" ]]; then
    local dir
    dir="$(command gwt "$@")" && cd "$dir"
  else
    command gwt "$@"
  fi
}

_gwt_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "${SUBCOMMANDS}" -- "$cur"))
    return
  fi
  case "\${COMP_WORDS[1]}" in
    ${WT_COMMANDS.split(" ").join("|")})
      COMPREPLY=($(compgen -W "$(command gwt list --names 2>/dev/null)" -- "$cur"))
      ;;
  esac
}
complete -F _gwt_completions gwt
`.trim();

const ZSH_ONLY = `
# gwt shell integration
gwt() {
  if [[ "$1" == "cd" || "$1" == "edit" ]]; then
    local dir
    dir="$(command gwt "$@")" && cd "$dir"
  else
    command gwt "$@"
  fi
}

_gwt() {
  local -a commands
  commands=(${SUBCOMMANDS})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
    ${WT_COMMANDS.split(" ").join("|")})
      local -a worktrees
      worktrees=(\${(f)"$(command gwt list --names 2>/dev/null)"})
      _describe 'worktree' worktrees
      ;;
  esac
}
compdef _gwt gwt
`.trim();

const FISH = `
# gwt shell integration
function gwt
  if test "$argv[1]" = "cd" -o "$argv[1]" = "edit"
    set -l dir (command gwt $argv)
    and cd $dir
  else
    command gwt $argv
  end
end

${SUBCOMMANDS.split(" ").map(cmd => `complete -c gwt -n '__fish_use_subcommand' -a ${cmd}`).join("\n")}

for cmd in ${WT_COMMANDS}
  complete -c gwt -n "__fish_seen_subcommand_from $cmd" -a '(command gwt list --names 2>/dev/null)'
end
`.trim();

export function shell(shellType?: string): void {
  const detected = shellType ?? detectShell();

  switch (detected) {
    case "fish":
      console.log(FISH);
      break;
    case "zsh":
      console.log(ZSH_ONLY);
      break;
    case "bash":
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
