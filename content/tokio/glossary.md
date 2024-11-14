---
title: Glossary
---

## Asynchronous

In the context of Rust, asynchronous code refers to code that uses the
async/await language feature, which allows many tasks to run concurrently on a
few threads (or even a single thread).

## Concurrency and parallelism

Concurrency and parallelism are two related concepts that are both used when
talking about performing multiple tasks at the same time. If something happens
in parallel, then it also happens concurrently, but the opposite is not true:
Alternating between two tasks, but never actually working on both at the same
time is concurrency but not parallelism.

## Future

A future is a value that stores the current state of some operation. A future
also has a `poll` method, that makes the operation continue until it needs to
wait for something, such as an network connection. Calls to the `poll` method
should return very quickly.

Futures are often created by combining multiple futures using `.await` in an
async block.

## Executor/scheduler

An executor or scheduler is something that executes futures by calling the
`poll` method repeatedly.  There is no executor in the standard library, so you
need an external library for this, and the most widely used executor is provided
by the Tokio runtime.

An executor is able to run a large number of futures concurrently on a few
threads. It does this by swapping the currently running task at awaits. If code
spends a long time without reaching an `.await`, that is called "blocking the
thread" or "not yielding back to the executor", which prevents other tasks from
running.

## Runtime

A runtime is a library that contains an executor along with various utilities
that integrate with that executor, such as timing utilities and IO. The words
runtime and executor are sometimes used interchangeably. The standard library
has no runtime, so you need an external library for this, and the most widely
used runtime is the Tokio runtime.

The word Runtime is also used in other contexts, e.g. the phrase "Rust has no
runtime" is sometimes used to mean that Rust performs no garbage collection or
just-in-time compilation.

## Task

A task is an operation running on the Tokio runtime, created by the
[`tokio::spawn`] or [`Runtime::block_on`] function. Tools for creating futures by
combining them such as `.await` and [`join!`] do not create new tasks, and each
combined part is said to be "in the same task".

Multiple tasks are required for parallelism, but it is possible to concurrently
do multiple things on one task using tools such as `join!`.

[`Runtime::block_on`]: https://docs.rs/tokio/1/tokio/runtime/struct.Runtime.html#method.block_on
[`join!`]: https://docs.rs/tokio/1/tokio/macro.join.html

## Spawning

Spawning is when the [`tokio::spawn`] function is used to create a new task. It
can also refer to creating new thread with [`std::thread::spawn`].

[`tokio::spawn`]: https://docs.rs/tokio/1/tokio/fn.spawn.html
[`std::thread::spawn`]: https://doc.rust-lang.org/stable/std/thread/fn.spawn.html

## Async block

An async block is an easy way to create a future that runs some code. For
example:

```rust
let world = async {
    println!(" world!");
};
let my_future = async {
    print!("Hello ");
    world.await;
};
```

The code above creates a future called `my_future`, which if executed prints
`Hello world!`. It does this by first printing hello, and then running the
`world` future. Note that the code above does not print anything on its own —
you have to actually execute `my_future` before anything happens, by either
spawning it directly, or by `.await`ing it in something you spawn.

## Async function

Similarly to an async block, an async function is an easy way to create a
function whose body becomes a future. All async functions can be rewritten into
ordinary functions that return a future:

```rust
async fn do_stuff(i: i32) -> String {
    // do stuff
    format!("The integer is {}.", i)
}
```

```rust
use std::future::Future;

// the async function above is the same as this:
fn do_stuff(i: i32) -> impl Future<Output = String> {
    async move {
        // do stuff
        format!("The integer is {}.", i)
    }
}
```

This uses [the `impl Trait` syntax][book10-02] to return a future, since
[`Future`] is a trait. Note that since the future created by an async block does
not do anything until it is executed, calling an async function does not do
anything until the future it returns is executed [(ignoring it triggers a
warning)][unused-warning].

[book10-02]: https://doc.rust-lang.org/book/ch10-02-traits.html#returning-types-that-implement-traits
[`Future`]: https://doc.rust-lang.org/stable/std/future/trait.Future.html
[unused-warning]: https://play.rust-lang.org/?version=stable&mode=debug&edition=2018&gist=4faf44e08b4a3bb1269a7985460f1923

## Yielding

In the context of asynchronous Rust, yielding is what allows the executor to
execute many futures on a single thread. Every time a future yields, the
executor is able to swap that future with some other future, and by repeatedly
swapping the current task, the executor can concurrently execute a large number
of tasks. A future can only yield at an `.await`, so futures that spend a long
time between `.await`s can prevent other tasks from running.

To be specific, a future yields whenever it returns from the [`poll`] method.

[`poll`]: https://doc.rust-lang.org/stable/std/future/trait.Future.html#method.poll

## Blocking

The word "blocking" is used in two different ways: The first meaning of
"blocking" is simply to wait for something to finish, and the other meaning of
blocking is when a future spend a long time without yielding. To be unambiguous,
you can use the phrase "blocking the thread" for the second meaning.

Tokio's documentation will always use the second meaning of "blocking".

To run blocking code within Tokio, please see the [CPU-bound tasks and blocking
code][api-blocking] section from the Tokio API reference.

[api-blocking]: https://docs.rs/tokio/1/tokio/#cpu-bound-tasks-and-blocking-code

## Stream

A [`Stream`] is an asynchronous version of an [`Iterator`], and provides a
stream of values. It is commonly used together with a `while let` loop like this:

```rust
use tokio_stream::StreamExt; // for next()

# async fn dox() {
# let mut stream = tokio_stream::empty::<()>();
while let Some(item) = stream.next().await {
    // do something
}
# }
```

The word stream is confusingly sometimes used to refer to the [`AsyncRead`] and
[`AsyncWrite`] traits.

Tokio's stream utilities are currently provided by the [`tokio-stream`] crate.
Once the `Stream` trait is stabilized in std, the stream utilities will be moved
into the `tokio` crate.

[`Stream`]: https://docs.rs/tokio-stream/0.1/tokio/trait.Stream.html
[`tokio-stream`]: https://docs.rs/tokio-stream
[`Iterator`]: https://doc.rust-lang.org/stable/std/iter/trait.Iterator.html
[`AsyncRead`]: https://docs.rs/tokio/1/tokio/io/trait.AsyncRead.html
[`AsyncWrite`]: https://docs.rs/tokio/1/tokio/io/trait.AsyncWrite.html

## Channel

A channel is a tool that allows one part of the code to send messages to other
parts. Tokio provides a [number of channels][channels], each serving a different
purpose.

- [mpsc]: multi-producer, single-consumer channel. Many values can be sent.
- [oneshot]: single-producer, single consumer channel. A single value can be sent.
- [broadcast]: multi-producer, multi-consumer. Many values can be send. Each
  receiver sees every value.
- [watch]: multi-producer, multi-consumer. Many values can be sent, but no
  history is kept. Receivers only see the most recent value.

If you need a multi-producer multi-consumer channel where only one consumer sees
each message, you can use the [`async-channel`] crate.

There are also channels for use outside of asynchronous Rust, such as
[`std::sync::mpsc`] and [`crossbeam::channel`]. These channels wait for messages
by blocking the thread, which is not allowed in asynchronous code.

[channels]: https://docs.rs/tokio/1/tokio/sync/index.html
[mpsc]: https://docs.rs/tokio/1/tokio/sync/mpsc/index.html
[oneshot]: https://docs.rs/tokio/1/tokio/sync/oneshot/index.html
[broadcast]: https://docs.rs/tokio/1/tokio/sync/broadcast/index.html
[watch]: https://docs.rs/tokio/1/tokio/sync/watch/index.html
[`async-channel`]: https://docs.rs/async-channel/
[`std::sync::mpsc`]: https://doc.rust-lang.org/stable/std/sync/mpsc/index.html
[`crossbeam::channel`]: https://docs.rs/crossbeam/latest/crossbeam/channel/index.html

## Backpressure

Backpressure is a pattern for designing applications that respond well to high
load. For example, the `mpsc` channel comes in both a bounded and unbounded
form. By using the bounded channel, the receiver can put "backpressure" on the
sender if the receiver can't keep up with the number of messages, which avoids
memory usage growing without bound as more and more messages are sent on the
channel.

## Actor

A design pattern for designing applications. An actor refers to an independently
spawned task that manages some resource on behalf of other parts of the
application, using channels to communicate with those other parts of the
application.

See [the channels chapter] for an example of an actor.

[the channels chapter]: /tokio/tutorial/channels
