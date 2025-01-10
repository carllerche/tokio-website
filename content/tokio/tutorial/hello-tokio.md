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

Next, add [tokio] and [mini-redis] to the `[dependencies]` section in the
`Cargo.toml` manifest:

[tokio]: https://crates.io/crates/tokio
[mini-redis]: https://crates.io/crates/mini-redis

```bash
cargo add tokio --features full
cargo add mini-redis
```

This will result in something similar to the following (the versions may be
later than this):

```toml
[dependencies]
tokio = { version = "1.41.1", features = ["full"] }
mini-redis = "0.4.1"
```

We use the `full` feature flag for simplicity. For more
information about the available feature flags see the [feature flags
topic](/tokio/topics/feature-flags).

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

    println!("got value from the server; result={result:?}");

    Ok(())
}
# }
```

## Run the code

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

# Troubleshooting

A common mistake is to forget to add `.await` on calls to asynchronous
functions. This is particularly easy to forget for functions where the return
value is not used by the application. The compiler warns you and teaches you how
to fix this error.

```plain
warning: unused implementer of `std::future::Future` that must be used
  --> examples/hello-redis.rs:12:5
   |
12 |     client.set("hello", "world".into());
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
   |
   = note: futures do nothing unless you `.await` or poll them
   = note: `#[warn(unused_must_use)]` on by default
```

# Breaking it down

Let's take some time to go over what we just did. There isn't much code, but a
lot is happening.

## Async `main` function

```rust
# use mini_redis::{Result};
#[tokio::main]
async fn main() -> Result<()> {
    // ...

    Ok(())
}
```

The main function is an asynchronous function. This is indicated by the `async`
keyword before the function definition. It returns `mini_redis::Result`. The
`Ok(())` value indicates that the program completed successfully. The
`#[tokio::main]` macro, wraps the asynchronous function in a standard
synchronous function and runs the asynchronous code on the tokio runtime.

For more information on this see the [Async `main` function] section of the
[Asynchronous Programming] topic.

[Async `main` function]: /tokio/topics/async#async-main-function
[Asynchronous Programming]: /tokio/topics/async

## Connecting to redis

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
synchronous. To actually run the connect operation, on the runtime, you need to
add the `await` keyword.

We use the `?` operator on this call as the method may fail if the underlying
connection cannot be established (e.g. if the server is not running).

[`client::connect`]: https://docs.rs/mini-redis/latest/mini_redis/client/fn.connect.html

## Setting and getting a key

To set a key, we use the [`Client::set`] method, passing the key and value. This
method is asynchronous, so we use `await`.

[`Client::set`]: https://docs.rs/mini-redis/latest/mini_redis/client/struct.Client.html#method.set

```rust
# use mini_redis::client;
# async fn dox() -> mini_redis::Result<()> {
# let mut client = client::connect("127.0.0.1:6379").await?;
client.set("hello", "world".into()).await?;
# Ok(())
# }
```

To get the value of a key, we use the [`Client::get`] method, which also requires `await`.

[`Client::get`]: https://docs.rs/mini-redis/latest/mini_redis/client/struct.Client.html#method.get

```rust
# use mini_redis::client;
# async fn dox() -> mini_redis::Result<()> {
# let mut client = client::connect("127.0.0.1:6379").await?;
let result = client.get("hello").await?;
# Ok(())
# }
```

The result is an `Option<Bytes>`, which will be `Some(Bytes)` if the key exists
or `None` if it does not. We print the Debug format of the result.

```rust,ignore
# let result = 42;
println!("got value from the server; result={result:?}");
```

# Conclusion

Congratulations on writing your first Tokio application! In the next section,
we will explore Tokio's asynchronous programming model in more detail.

If you have any questions, feel free to ask on the [Tokio Discord server] or
[GitHub Discussions].

[Tokio Discord server]: https://discord.gg/tokio
[GitHub Discussions]: https://github.com/tokio-rs/tokio/discussions
