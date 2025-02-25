---
title: "Select"
---

So far, when we wanted to add concurrency to the system, we spawned a new task.
We will now cover some additional ways to concurrently execute asynchronous code
with Tokio.

# `tokio::select!`

The `tokio::select!` macro allows waiting on multiple async computations and
returns when a **single** computation completes.

For example:

```rust
use tokio::sync::oneshot;

#[tokio::main]
async fn main() {
    let (tx1, rx1) = oneshot::channel();
    let (tx2, rx2) = oneshot::channel();

    tokio::spawn(async {
        let _ = tx1.send("one");
    });

    tokio::spawn(async {
        let _ = tx2.send("two");
    });

    tokio::select! {
        val = rx1 => {
            println!("rx1 completed first with {:?}", val);
        }
        val = rx2 => {
            println!("rx2 completed first with {:?}", val);
        }
    }
}
```

Two oneshot channels are used. Either channel could complete first. The
`select!` statement awaits on both channels and binds `val` to the value
returned by the task. When either `tx1` or `tx2` complete, the associated block
is executed.

The branch that **does not** complete is dropped. In the example, the
computation is awaiting the `oneshot::Receiver` for each channel. The
`oneshot::Receiver` for the channel that did not complete yet is dropped.

## Cancellation

With asynchronous Rust, cancellation is performed by dropping a future. Recall
from ["Async in depth"][async], async Rust operation are implemented using
futures and futures are lazy. The operation only proceeds when the future is
polled. If the future is dropped, the operation cannot proceed because all
associated state has been dropped.

That said, sometimes an asynchronous operation will spawn background tasks or
start other operation that run in the background. For example, in the above
example, a task is spawned to send a message back. Usually, the task will
perform some computation to generate the value.

Futures or other types can implement `Drop` to cleanup background resources.
Tokio's `oneshot::Receiver` implements `Drop` by sending a closed notification to
the `Sender` half. The sender half can receive this notification and abort the
in-progress operation by dropping it.

```rust
use tokio::sync::oneshot;

async fn some_operation() -> String {
    // Compute value here
# "wut".to_string()
}

#[tokio::main]
async fn main() {
    let (mut tx1, rx1) = oneshot::channel();
    let (tx2, rx2) = oneshot::channel();

    tokio::spawn(async {
        // Select on the operation and the oneshot's
        // `closed()` notification.
        tokio::select! {
            val = some_operation() => {
                let _ = tx1.send(val);
            }
            _ = tx1.closed() => {
                // `some_operation()` is canceled, the
                // task completes and `tx1` is dropped.
            }
        }
    });

    tokio::spawn(async {
        let _ = tx2.send("two");
    });

    tokio::select! {
        val = rx1 => {
            println!("rx1 completed first with {:?}", val);
        }
        val = rx2 => {
            println!("rx2 completed first with {:?}", val);
        }
    }
}
```

[async]: async

## The `Future` implementation

To help better understand how `select!` works, let's look at what a hypothetical
`Future` implementation would look like. This is a simplified version. In
practice, `select!` includes additional functionality like randomly selecting
the branch to poll first.

```rust
use tokio::sync::oneshot;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

struct MySelect {
    rx1: oneshot::Receiver<&'static str>,
    rx2: oneshot::Receiver<&'static str>,
}

impl Future for MySelect {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if let Poll::Ready(val) = Pin::new(&mut self.rx1).poll(cx) {
            println!("rx1 completed first with {:?}", val);
            return Poll::Ready(());
        }

        if let Poll::Ready(val) = Pin::new(&mut self.rx2).poll(cx) {
            println!("rx2 completed first with {:?}", val);
            return Poll::Ready(());
        }

        Poll::Pending
    }
}

#[tokio::main]
async fn main() {
    let (tx1, rx1) = oneshot::channel();
    let (tx2, rx2) = oneshot::channel();

    // use tx1 and tx2
# tx1.send("one").unwrap();
# tx2.send("two").unwrap();

    MySelect {
        rx1,
        rx2,
    }.await;
}
```

The `MySelect` future contains the futures from each branch. When `MySelect` is
polled, the first branch is polled. If it is ready, the value is used and
`MySelect` completes. After `.await` receives the output from a future, the
future is dropped. This results in the futures for both branches to be dropped.
As one branch did not complete, the operation is effectively cancelled.

Remember from the previous section:

> When a future returns `Poll::Pending`, it **must** ensure the waker is
> signalled at some point in the future. Forgetting to do this results in the
> task hanging indefinitely.

There is no explicit usage of the `Context` argument in the `MySelect`
implementation. Instead, the waker requirement is met by passing `cx` to the
inner futures. As the inner future must also meet the waker requirement, by only
returning `Poll::Pending` when receiving `Poll::Pending` from an inner future,
`MySelect` also meets the waker requirement.

# Syntax

The `select!` macro can handle more than two branches. The current limit is 64
branches. Each branch is structured as:

```text
<pattern> = <async expression> => <handler>,
```

When the `select` macro is evaluated, all the `<async expression>`s are
aggregated and executed concurrently. When an expression completes, the result
is matched against `<pattern>`. If the result matches the pattern, then all
remaining async expressions are dropped and `<handler>` is executed. The
`<handler>` expression has access to any bindings established by `<pattern>`.

The basic case for `<pattern>` is a variable name, the result of the async
expression is bound to the variable name and `<handler>` has access to that
variable. This is why, in the original example, `val` was used for `<pattern>`
and `<handler>` was able to access `val`.

If `<pattern>` **does not** match the result of the async computation, then the
remaining async expressions continue to execute concurrently until the next one
completes. At this time, the same logic is applied to that result.

Because `select!` takes any async expression, it is possible to define more
complicated computations to select on.

Here, we select on the output of a `oneshot` channel and a TCP connection.

```rust
use tokio::net::TcpStream;
use tokio::sync::oneshot;

#[tokio::main]
async fn main() {
    let (tx, rx) = oneshot::channel();

    // Spawn a task that sends a message over the oneshot
    tokio::spawn(async move {
        tx.send("done").unwrap();
    });

    tokio::select! {
        socket = TcpStream::connect("localhost:3465") => {
            println!("Socket connected {:?}", socket);
        }
        msg = rx => {
            println!("received message first {:?}", msg);
        }
    }
}
```

Here, we select on a oneshot and accepting sockets from a `TcpListener`.

```rust
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use std::io;

#[tokio::main]
async fn main() -> io::Result<()> {
    let (tx, rx) = oneshot::channel();

    tokio::spawn(async move {
        tx.send(()).unwrap();
    });

    let mut listener = TcpListener::bind("localhost:3465").await?;

    tokio::select! {
        _ = async {
            loop {
                let (socket, _) = listener.accept().await?;
                tokio::spawn(async move { process(socket) });
            }

            // Help the rust type inferencer out
            Ok::<_, io::Error>(())
        } => {}
        _ = rx => {
            println!("terminating accept loop");
        }
    }

    Ok(())
}
# async fn process(_: tokio::net::TcpStream) {}
```

The accept loop runs until an error is encountered or `rx` receives a value. The
`_` pattern indicates that we have no interest in the return value of the async
computation.

# Return value

The `tokio::select!` macro returns the result of the evaluated `<handler>` expression.

```rust
async fn computation1() -> String {
    // .. computation
# unimplemented!();
}

async fn computation2() -> String {
    // .. computation
# unimplemented!();
}

# fn dox() {
#[tokio::main]
async fn main() {
    let out = tokio::select! {
        res1 = computation1() => res1,
        res2 = computation2() => res2,
    };

    println!("Got = {}", out);
}
# }
```

Because of this, it is required that the `<handler>` expression for **each**
branch evaluates to the same type. If the output of a `select!` expression is
not needed, it is good practice to have the expression evaluate to `()`.

# Errors

Using the `?` operator propagates the error from the expression. How this works
depends on whether `?` is used from an async expression or from a handler.
Using `?` in an async expression propagates the error out of the async
expression. This makes the output of the async expression a `Result`. Using `?`
from a handler immediately propagates the error out of the `select!` expression.
Let's look at the accept loop example again:

```rust
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use std::io;

#[tokio::main]
async fn main() -> io::Result<()> {
    // [setup `rx` oneshot channel]
# let (tx, rx) = oneshot::channel();
# tx.send(()).unwrap();

    let listener = TcpListener::bind("localhost:3465").await?;

    tokio::select! {
        res = async {
            loop {
                let (socket, _) = listener.accept().await?;
                tokio::spawn(async move { process(socket) });
            }

            // Help the rust type inferencer out
            Ok::<_, io::Error>(())
        } => {
            res?;
        }
        _ = rx => {
            println!("terminating accept loop");
        }
    }

    Ok(())
}
# async fn process(_: tokio::net::TcpStream) {}
```

Notice `listener.accept().await?`. The `?` operator propagates the error out of
that expression and to the `res` binding. On an error, `res` will be set to
`Err(_)`. Then, in the handler, the `?` operator is used again. The `res?`
statement will propagate an error out of the `main` function.

# Pattern matching

Recall that the `select!` macro branch syntax was defined as:

```text
<pattern> = <async expression> => <handler>,
```

So far, we have only used variable bindings for `<pattern>`. However, any Rust
pattern can be used. For example, say we are receiving from multiple MPSC
channels, we might do something like this:

```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (mut tx1, mut rx1) = mpsc::channel(128);
    let (mut tx2, mut rx2) = mpsc::channel(128);

    tokio::spawn(async move {
        // Do something w/ `tx1` and `tx2`
# tx1.send(1).await.unwrap();
# tx2.send(2).await.unwrap();
    });

    tokio::select! {
        Some(v) = rx1.recv() => {
            println!("Got {:?} from rx1", v);
        }
        Some(v) = rx2.recv() => {
            println!("Got {:?} from rx2", v);
        }
        else => {
            println!("Both channels closed");
        }
    }
}
```

In this example, the `select!` expression waits on receiving a value from `rx1`
and `rx2`. If a channel closes, `recv()` returns `None`. This **does not** match
the pattern and the branch is disabled. The `select!` expression will continue
waiting on the remaining branches.

Notice that this `select!` expression includes an `else` branch. The `select!`
expression must evaluate to a value. When using pattern matching, it is possible
that **none** of the branches match their associated patterns. If this happens,
the `else` branch is evaluated.

# Borrowing

When spawning tasks, the spawned async expression must own all of its data. The
`select!` macro does not have this limitation. Each branch's async expression
may borrow data and operate concurrently. Following Rust's borrow rules,
multiple async expressions may immutably borrow a single piece of data **or** a
single async expression may mutably borrow a piece of data.

Let's look at some examples. Here, we simultaneously send the same data to two
different TCP destinations.

```rust
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use std::io;
use std::net::SocketAddr;

async fn race(
    data: &[u8],
    addr1: SocketAddr,
    addr2: SocketAddr
) -> io::Result<()> {
    tokio::select! {
        Ok(_) = async {
            let mut socket = TcpStream::connect(addr1).await?;
            socket.write_all(data).await?;
            Ok::<_, io::Error>(())
        } => {}
        Ok(_) = async {
            let mut socket = TcpStream::connect(addr2).await?;
            socket.write_all(data).await?;
            Ok::<_, io::Error>(())
        } => {}
        else => {}
    };

    Ok(())
}
# fn main() {}
```

The `data` variable is being borrowed **immutably** from both async expressions.
When one of the operations completes successfully, the other one is dropped.
Because we pattern match on `Ok(_)`, if an expression fails, the other one
continues to execute.

When it comes to each branch's `<handler>`, `select!` guarantees that only a
single `<handler>` runs. Because of this, each `<handler>` may mutably borrow
the same data.

For example this modifies `out` in both handlers:

```rust
use tokio::sync::oneshot;

#[tokio::main]
async fn main() {
    let (tx1, rx1) = oneshot::channel();
    let (tx2, rx2) = oneshot::channel();

    let mut out = String::new();

    tokio::spawn(async move {
        // Send values on `tx1` and `tx2`.
# let _ = tx1.send("one");
# let _ = tx2.send("two");
    });

    tokio::select! {
        _ = rx1 => {
            out.push_str("rx1 completed");
        }
        _ = rx2 => {
            out.push_str("rx2 completed");
        }
    }

    println!("{}", out);
}
```

# Loops

The `select!` macro is often used in loops. This section will go over some
examples to show common ways of using the `select!` macro in a loop. We start
by selecting over multiple channels:

```rust
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let (tx1, mut rx1) = mpsc::channel(128);
    let (tx2, mut rx2) = mpsc::channel(128);
    let (tx3, mut rx3) = mpsc::channel(128);
# tx1.clone().send("hello").await.unwrap();
# drop((tx1, tx2, tx3));

    loop {
        let msg = tokio::select! {
            Some(msg) = rx1.recv() => msg,
            Some(msg) = rx2.recv() => msg,
            Some(msg) = rx3.recv() => msg,
            else => { break }
        };

        println!("Got {:?}", msg);
    }

    println!("All channels have been closed.");
}
```

This example selects over the three channel receivers. When a message is
received on any channel, it is written to STDOUT. When a channel is closed,
`recv()` returns with `None`. By using pattern matching, the `select!`
macro continues waiting on the remaining channels. When all channels are
closed, the `else` branch is evaluated and the loop is terminated.

The `select!` macro randomly picks branches to check first for readiness. When
multiple channels have pending values, a random channel will be picked to
receive from. This is to handle the case where the receive loop processes
messages slower than they are pushed into the channels, meaning that the
channels start to fill up. If `select!` **did not** randomly pick a branch
to check first, on each iteration of the loop, `rx1` would be checked first. If
`rx1` always contained a new message, the remaining channels would never be
checked.

> **info**
> If when `select!` is evaluated, multiple channels have pending messages, only
> one channel has a value popped. All other channels remain untouched, and their
> messages stay in those channels until the next loop iteration. No messages are
> lost.

## Resuming an async operation

Now we will show how to run an asynchronous operation across multiple calls to
`select!`. In this example, we have an MPSC channel with item type `i32`, and an
asynchronous function. We want to run the asynchronous function until it
completes or an even integer is received on the channel.

```rust
async fn action() {
    // Some asynchronous logic
}

#[tokio::main]
async fn main() {
    let (mut tx, mut rx) = tokio::sync::mpsc::channel(128);    
#   tokio::spawn(async move {
#       let _ = tx.send(1).await;
#       let _ = tx.send(2).await;
#   });
    
    let operation = action();
    tokio::pin!(operation);
    
    loop {
        tokio::select! {
            _ = &mut operation => break,
            Some(v) = rx.recv() => {
                if v % 2 == 0 {
                    break;
                }
            }
        }
    }
}
```

Note how, instead of calling `action()` in the `select!` macro, it is called
**outside** the loop. The return of `action()` is assigned to `operation`
**without** calling `.await`. Then we call `tokio::pin!` on `operation`.

Inside the `select!` loop, instead of passing in `operation`, we pass in `&mut
operation`. The `operation` variable is tracking the in-flight asynchronous
operation. Each iteration of the loop uses the same operation instead of issuing
a new call to `action()`.

The other `select!` branch receives a message from the channel. If the message
is even, we are done looping. Otherwise, start the `select!` again.

This is the first time we use `tokio::pin!`. We aren't going to get into the
details of pinning yet. The thing to note is that, to `.await` a reference,
the value being referenced must be pinned or implement `Unpin`.

If we remove the `tokio::pin!` line and try to compile, we get the following
error:

```text
error[E0599]: no method named `poll` found for struct
     `std::pin::Pin<&mut &mut impl std::future::Future>`
     in the current scope
  --> src/main.rs:16:9
   |
16 | /         tokio::select! {
17 | |             _ = &mut operation => break,
18 | |             Some(v) = rx.recv() => {
19 | |                 if v % 2 == 0 {
...  |
22 | |             }
23 | |         }
   | |_________^ method not found in
   |             `std::pin::Pin<&mut &mut impl std::future::Future>`
   |
   = note: the method `poll` exists but the following trait bounds
            were not satisfied:
           `impl std::future::Future: std::marker::Unpin`
           which is required by
           `&mut impl std::future::Future: std::future::Future`
```

Although we covered `Future` in [the previous chapter][async], this error still isn't
very clear. If you hit such an error about `Future` not being implemented when attempting
to call `.await` on a **reference**, then the future probably needs to be pinned.

Read more about [`Pin`][pin] on the [standard library][pin].

[pin]: https://doc.rust-lang.org/std/pin/index.html

## Modifying a branch

Let's look at a slightly more complicated loop. We have:

1. A channel of `i32` values.
2. An async operation to perform on `i32` values.

The logic we want to implement is:

1. Wait for an **even** number on the channel.
2. Start the asynchronous operation using the even number as input.
3. Wait for the operation, but at the same time listen for more even numbers on
   the channel.
4. If a new even number is received before the existing operation completes,
   abort the existing operation and start it over with the new even number.

```rust
async fn action(input: Option<i32>) -> Option<String> {
    input.map(|i| {
        // async logic here
#       i.to_string()
    })
}

#[tokio::main]
async fn main() {
    let (mut tx, mut rx) = tokio::sync::mpsc::channel(128);
    
    let mut done = false;
    let operation = action(None);
    tokio::pin!(operation);
    
    tokio::spawn(async move {
        let _ = tx.send(1).await;
        let _ = tx.send(3).await;
        let _ = tx.send(2).await;
    });
    
    loop {
        tokio::select! {
            res = &mut operation, if !done => {
                done = true;

                if let Some(v) = res {
                    println!("GOT = {}", v);
                    return;
                }
            }
            Some(v) = rx.recv() => {
                if v % 2 == 0 {
                    // `.set` is a method on `Pin`.
                    operation.set(action(Some(v)));
                    done = false;
                }
            }
        }
    }
}
```

We use a similar strategy as the previous example. The async fn is called
outside of the loop and assigned to `operation`. The `operation` variable is
pinned. The loop selects on both `operation` and the channel receiver.

Notice how `action` takes `Option<i32>` as an argument. Before we receive the
first even number, we need to instantiate `operation` to something. We make
`action` take `Option` and return `Option`. If `None` is passed in, `None` is
returned. The first loop iteration, `operation` completes immediately with
`None`.

This example uses some new syntax. The first branch includes `, if !done`. This
is a branch precondition. Before explaining how it works, let's look at what
happens if the precondition is omitted. Leaving out `, if !done` and running the
example results in the following output:

```text
thread 'main' panicked at '`async fn` resumed after completion', src/main.rs:1:55
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

This error happens when attempting to use `operation` **after** it has already
completed. Usually, when using `.await`, the value being awaited is consumed. In
this example, we await on a reference. This means `operation` is still around
after it has completed.

To avoid this panic, we must take care to disable the first branch if
`operation` has completed. The `done` variable is used to track whether or not
`operation` completed. A `select!` branch may include a **precondition**. This
precondition is checked **before** `select!` awaits on the branch. If the
condition evaluates to `false` then the branch is disabled. The `done` variable
is initialized to `false`. When `operation` completes, `done` is set to `true`.
The next loop iteration will disable the `operation` branch. When an even
message is received from the channel, `operation` is reset and `done` is set to
`false`.

# Per-task concurrency

Both `tokio::spawn` and `select!` enable running concurrent asynchronous
operations. However, the strategy used to run concurrent operations differs. The
`tokio::spawn` function takes an asynchronous operation and spawns a new task to
run it. A task is the object that the Tokio runtime schedules. Two different
tasks are scheduled independently by Tokio. They may run simultaneously on
different operating system threads. Because of this, a spawned task has the same
restriction as a spawned thread: no borrowing.

The `select!` macro runs all branches concurrently **on the same task**. Because
all branches of the `select!` macro are executed on the same task, they will
never run **simultaneously**. The `select!` macro multiplexes asynchronous
operations on a single task.
