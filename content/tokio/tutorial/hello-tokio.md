---
title: "Hello Tokio"
---

We will get started by writing a very basic Tokio application. It will connect
to the Mini-Redis server, set the value of the key `hello` to `world`. It will
then read back the key. This will be done using the Mini-Redis client library.

# The code

## Generate a new crate

Let's start by generating a new Rust app:

```bash
cargo new my-redis
cd my-redis
```

## Add dependencies

Add the following dependencies to your `Cargo.toml` file:

```bash
cargo add tokio --features full
cargo add mini-redis
```

## Write the code

Then, open `main.rs` and replace the contents of the file with:

```rust
use mini_redis::{client, Result};

# fn dox() {
#[tokio::main]
async fn main() -> Result<()> {
    // Open a connection to the mini-redis address.
    let mut client = client::connect("127.0.0.1:6379").await?;

    // Set the key "hello" with value "world"
    client.set("hello", "world".into()).await?;

    // Get key "hello"
    let result = client.get("hello").await?;

    println!("got value from the server; result={:?}", result);

    Ok(())
}
# }
```

Make sure the Mini-Redis server is running. In a separate terminal window, run:

```bash
mini-redis-server
```

If you have not already installed mini-redis, you can do so with

```bash
cargo install mini-redis
```

Now, run the `my-redis` application:

```bash
$ cargo run
got value from the server; result=Some(b"world")
```

Success!

You can find the full code [here][full].

[full]: https://github.com/tokio-rs/website/blob/master/tutorial-code/hello-tokio/src/main.rs

# Breaking it down

Let's take some time to go over what we just did. There isn't much code, but a
lot is happening.

```rust
# use mini_redis::client;
# async fn dox() -> mini_redis::Result<()> {
let mut client = client::connect("127.0.0.1:6379").await?;
# Ok(())
# }
```

The [`client::connect`] function is provided by the `mini-redis` crate. It
asynchronously establishes a TCP connection with the specified remote address.
Once the connection is established, a `client` handle is returned. Even though
the operation is performed asynchronously, the code we write **looks**
synchronous. The only indication that the operation is asynchronous is the
`.await` operator.

[`client::connect`]: https://docs.rs/mini-redis/0.4/mini_redis/client/fn.connect.html

## What is asynchronous programming?

Most computer programs are executed in the same order in which they are written.
The first line executes, then the next, and so on.  With synchronous programming,
when a program encounters an operation that cannot be completed immediately, it
will block until the operation completes. For example, establishing a TCP
connection requires an exchange with a peer over the network, which can take a
sizeable amount of time. During this time, the thread is blocked.

With asynchronous programming, operations that cannot complete immediately are
suspended to the background. The thread is not blocked, and can continue running
other things. Once the operation completes, the task is unsuspended and continues
processing from where it left off. Our example from before only has one task, so
nothing happens while it is suspended, but asynchronous programs typically have
many such tasks.

Although asynchronous programming can result in faster applications, it often
results in much more complicated programs. The programmer is required to track
all the state necessary to resume work once the asynchronous operation
completes. Historically, this is a tedious and error-prone task.

## Compile-time green-threading

Rust implements asynchronous programming using a feature called [`async/await`].
Functions that perform asynchronous operations are labeled with the `async`
keyword. In our example, the `connect` function is defined like this:

```rust
use mini_redis::Result;
use mini_redis::client::Client;
use tokio::net::ToSocketAddrs;

pub async fn connect<T: ToSocketAddrs>(addr: T) -> Result<Client> {
    // ...
# unimplemented!()
}
```

The `async fn` definition looks like a regular synchronous function, but
operates asynchronously. Rust transforms the `async fn` at **compile** time into
a routine that operates asynchronously. Any calls to `.await` within the `async
fn` yield control back to the thread. The thread may do other work while the
operation processes in the background.

> **warning**
> Although other languages implement [`async/await`] too, Rust takes a unique
> approach. Primarily, Rust's async operations are **lazy**. This results in
> different runtime semantics than other languages.

[`async/await`]: https://en.wikipedia.org/wiki/Async/await

If this doesn't quite make sense yet, don't worry. We will explore `async/await`
more throughout the guide.

## Using `async/await`

Async functions are called like any other Rust function. However, calling these
functions does not result in the function body executing. Instead, calling an
`async fn` returns a value representing the operation. This is conceptually
analogous to a zero-argument closure. To actually run the operation, you should
use the `.await` operator on the return value.

For example, the given program

```rust
async fn say_world() {
    println!("world");
}

#[tokio::main]
async fn main() {
    // Calling `say_world()` does not execute the body of `say_world()`.
    let op = say_world();

    // This println! comes first
    println!("hello");

    // Calling `.await` on `op` starts executing `say_world`.
    op.await;
}
```

outputs:

```text
hello
world
```

The return value of an `async fn` is an anonymous type that implements the
[`Future`] trait.

[`Future`]: https://doc.rust-lang.org/std/future/trait.Future.html

## Async `main` function

The main function used to launch the application differs from the usual one
found in most of Rust's crates.

1. It is an `async fn`
2. It is annotated with `#[tokio::main]`

An `async fn` is used as we want to enter an asynchronous context. However,
asynchronous functions must be executed by a [runtime]. The runtime contains the
asynchronous task scheduler, provides evented I/O, timers, etc. The runtime does
not automatically start, so the main function needs to start it.

The `#[tokio::main]` function is a macro. It transforms the `async fn main()`
into a synchronous `fn main()` that initializes a runtime instance and executes
the async main function.

For example, the following:

```rust
#[tokio::main]
async fn main() {
    println!("hello");
}
```

gets transformed into:

```rust
fn main() {
    let mut rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        println!("hello");
    })
}
```

The details of the Tokio runtime will be covered later.

[runtime]: https://docs.rs/tokio/1/tokio/runtime/index.html

## Cargo features

When depending on Tokio for this tutorial, the `full` feature flag is enabled:

```toml
tokio = { version = "1", features = ["full"] }
```

Tokio has a lot of functionality (TCP, UDP, Unix sockets, timers, sync
utilities, multiple scheduler types, etc). Not all applications need all
functionality. When attempting to optimize compile time or the end application
footprint, the application can decide to opt into **only** the features it uses.
