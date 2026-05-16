use std::env;
use std::ffi::OsString;

use crate::{AppResult, arg_to_str};

const BASH_ZSH: &str = r#"# gwt shell integration
gwt() {
  if [[ "$1" == "cd" || "$1" == "edit" || "$1" == "add" ]]; then
    local dir
    dir="$(command gwt "$@")" && cd "$dir"
  else
    command gwt "$@"
  fi
}

_gwt_completions() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "clone init add rm list ls lock unlock move cd cache edit run sync pr mr shell install update" -- "$cur"))
    return
  fi
  case "${COMP_WORDS[1]}" in
    cache)
      COMPREPLY=($(compgen -W "unlink prune" -- "$cur"))
      ;;
    cd|edit|rm|sync|pr|mr|lock|unlock|move|run)
      COMPREPLY=($(compgen -W "$(command gwt list --names 2>/dev/null)" -- "$cur"))
      ;;
  esac
}
complete -F _gwt_completions gwt"#;

const ZSH_ONLY: &str = r#"# gwt shell integration
gwt() {
  if [[ "$1" == "cd" || "$1" == "edit" || "$1" == "add" ]]; then
    local dir
    dir="$(command gwt "$@")" && cd "$dir"
  else
    command gwt "$@"
  fi
}

_gwt() {
  local -a commands
  commands=(clone init add rm list ls lock unlock move cd cache edit run sync pr mr shell install update)
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "${words[2]}" in
    cache)
      local -a cache_commands
      cache_commands=(unlink prune)
      _describe 'cache command' cache_commands
      ;;
    cd|edit|rm|sync|pr|mr|lock|unlock|move|run)
      local -a worktrees
      worktrees=(${(f)"$(command gwt list --names 2>/dev/null)"})
      _describe 'worktree' worktrees
      ;;
  esac
}
compdef _gwt gwt"#;

const FISH: &str = r#"# gwt shell integration
function gwt
  if test "$argv[1]" = "cd" -o "$argv[1]" = "edit" -o "$argv[1]" = "add"
    set -l dir (command gwt $argv)
    and cd $dir
  else
    command gwt $argv
  end
end

complete -c gwt -n '__fish_use_subcommand' -a clone
complete -c gwt -n '__fish_use_subcommand' -a init
complete -c gwt -n '__fish_use_subcommand' -a add
complete -c gwt -n '__fish_use_subcommand' -a rm
complete -c gwt -n '__fish_use_subcommand' -a list
complete -c gwt -n '__fish_use_subcommand' -a ls
complete -c gwt -n '__fish_use_subcommand' -a lock
complete -c gwt -n '__fish_use_subcommand' -a unlock
complete -c gwt -n '__fish_use_subcommand' -a move
complete -c gwt -n '__fish_use_subcommand' -a cd
complete -c gwt -n '__fish_use_subcommand' -a cache
complete -c gwt -n '__fish_use_subcommand' -a edit
complete -c gwt -n '__fish_use_subcommand' -a run
complete -c gwt -n '__fish_use_subcommand' -a sync
complete -c gwt -n '__fish_use_subcommand' -a pr
complete -c gwt -n '__fish_use_subcommand' -a mr
complete -c gwt -n '__fish_use_subcommand' -a shell
complete -c gwt -n '__fish_use_subcommand' -a install
complete -c gwt -n '__fish_use_subcommand' -a update
complete -c gwt -n '__fish_seen_subcommand_from cache' -a unlink
complete -c gwt -n '__fish_seen_subcommand_from cache' -a prune

for cmd in cd edit rm sync pr mr lock unlock move run
  complete -c gwt -n "__fish_seen_subcommand_from $cmd" -a '(command gwt list --names 2>/dev/null)'
end"#;

const POWERSHELL: &str = r#"# gwt shell integration
function gwt {
  if ($args.Count -gt 0 -and @('cd', 'edit', 'add') -contains $args[0]) {
    $dir = & gwt.exe @args
    if ($LASTEXITCODE -eq 0 -and $dir) {
      Set-Location $dir
    }
  } else {
    & gwt.exe @args
  }
}

Register-ArgumentCompleter -CommandName gwt -ScriptBlock {
  param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)

  $commands = @('clone', 'init', 'add', 'rm', 'list', 'ls', 'lock', 'unlock', 'move', 'cd', 'cache', 'edit', 'run', 'sync', 'pr', 'mr', 'shell', 'install', 'update')
  $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })

  if ($tokens.Count -le 1) {
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  if ($tokens[0] -eq 'cache') {
    @('unlink', 'prune') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  if (@('cd', 'edit', 'rm', 'sync', 'pr', 'mr', 'lock', 'unlock', 'move', 'run') -contains $tokens[0]) {
    & gwt.exe list --names 2>$null | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}"#;

pub fn run(args: &[OsString]) -> AppResult<()> {
    let shell = if let Some(arg) = args.first() {
        Some(arg_to_str(arg)?)
    } else {
        None
    };

    let detected = shell.unwrap_or_else(|| detect_shell().unwrap_or("bash"));
    let script = match detected {
        "fish" => FISH,
        "zsh" => ZSH_ONLY,
        "powershell" | "pwsh" => POWERSHELL,
        _ => BASH_ZSH,
    };

    println!("{script}");
    Ok(())
}

fn detect_shell() -> Option<&'static str> {
    if cfg!(windows) {
        return Some("powershell");
    }

    let shell = env::var("SHELL").ok()?;
    if shell.contains("fish") {
        Some("fish")
    } else if shell.contains("zsh") {
        Some("zsh")
    } else {
        Some("bash")
    }
}

#[cfg(test)]
mod tests {
    use super::{BASH_ZSH, FISH, POWERSHELL, ZSH_ONLY};

    #[test]
    fn bash_output_contains_wrapper() {
        assert!(BASH_ZSH.contains("gwt()"));
        assert!(BASH_ZSH.contains("complete -F _gwt_completions gwt"));
    }

    #[test]
    fn zsh_output_contains_compdef() {
        assert!(ZSH_ONLY.contains("compdef _gwt gwt"));
        assert!(ZSH_ONLY.contains("_describe"));
    }

    #[test]
    fn fish_output_contains_completions() {
        assert!(FISH.contains("function gwt"));
        assert!(FISH.contains("__fish_seen_subcommand_from"));
    }

    #[test]
    fn powershell_output_contains_wrapper() {
        assert!(POWERSHELL.contains("function gwt"));
        assert!(POWERSHELL.contains("Register-ArgumentCompleter"));
        assert!(POWERSHELL.contains("gwt.exe list --names"));
    }
}
