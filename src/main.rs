mod add;
mod cache;
mod cd;
mod clone_cmd;
mod edit;
mod init_cmd;
mod install;
mod list;
mod lock;
mod mr;
mod pr;
mod repo;
mod rm;
mod run_cmd;
mod shell;
mod sync;
mod update;
mod validation;

use std::env;
use std::ffi::{OsStr, OsString};

type AppResult<T> = Result<T, String>;

fn main() {
    let args = env::args_os().collect::<Vec<_>>();
    let code = match run(&args) {
        Ok(code) => code,
        Err(message) => {
            if message.is_empty() {
                0
            } else {
                eprintln!("{message}");
                1
            }
        }
    };

    if code != 0 {
        std::process::exit(code);
    }
}

fn run(args: &[OsString]) -> AppResult<i32> {
    let raw_args = if args.len() > 1 { &args[1..] } else { &[][..] };

    if raw_args.len() == 1 && raw_args[0] == OsStr::new("--version") {
        println!("{}", repo::get_current_version());
        return Ok(0);
    }

    let Some(command) = raw_args.first() else {
        print_usage();
        return Ok(0);
    };

    match arg_to_str(command)? {
        "clone" => clone_cmd::run(&raw_args[1..]).map(|_| 0),
        "init" => init_cmd::run(&raw_args[1..]).map(|_| 0),
        "add" => add::run(&raw_args[1..]).map(|_| 0),
        "rm" => rm::run(&raw_args[1..]).map(|_| 0),
        "list" | "ls" => list::run(&raw_args[1..]).map(|_| 0),
        "lock" => lock::run_lock(&raw_args[1..]).map(|_| 0),
        "unlock" => lock::run_unlock(&raw_args[1..]).map(|_| 0),
        "move" => lock::run_move(&raw_args[1..]).map(|_| 0),
        "cd" => cd::run(&raw_args[1..]).map(|_| 0),
        "cache" => cache::run(&raw_args[1..]).map(|_| 0),
        "edit" => edit::run(&raw_args[1..]).map(|_| 0),
        "run" => run_cmd::run(&raw_args[1..]).map(|_| 0),
        "sync" => sync::run(&raw_args[1..]).map(|_| 0),
        "pr" => pr::run(&raw_args[1..]).map(|_| 0),
        "mr" => mr::run(&raw_args[1..]).map(|_| 0),
        "shell" => shell::run(&raw_args[1..]).map(|_| 0),
        "install" => install::run(&raw_args[1..]).map(|_| 0),
        "update" => update::run(&raw_args[1..]).map(|_| 0),
        "--help" | "-h" => {
            print_usage();
            Ok(0)
        }
        other => Err(format!("Error: unknown command '{}'", other)),
    }
}

fn arg_to_str(arg: &OsStr) -> AppResult<&str> {
    arg.to_str()
        .ok_or_else(|| "Error: non-UTF-8 arguments are not supported".to_string())
}

fn print_usage() {
    println!("gwt {}", repo::get_current_version());
    println!(
        "Commands: clone init add rm list ls lock unlock move cd cache edit run sync pr mr shell install update"
    );
}
