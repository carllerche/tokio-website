---
title: "Async in depth"
---

At this point, we have completed a fairly comprehensive tour of asynchronous
Rust and Tokio. Now we will dig deeper into Rust's asynchronous runtime model.
At the very beginning of the tutorial, we hinted that asynchronous Rust takes a
unique approach. Now, we explain what that means.

# Futures

As a quick review, let's take a very basic asynchronous function. This is
nothing new compared to what the tutorial has covered so far.

```rust
use tokio::net::TcpStream;

async fn my_async_fn() {
    println!("hello from async");
    let _socket = TcpStream::connect("127.0.0.1:3000").await.unwrap();
    println!("async TCP operation complete");
}
```

We call the function and it returns some value. We call `.await` on that value.

```rust
# async fn my_async_fn() {}
#[tokio::main]
async fn main() {
    let what_is_this = my_async_fn();
    // Nothing has been printed yet.
    what_is_this.await;
    // Text has been printed and socket has been
    // established and closed.
}
```

The value returned by `my_async_fn()` is a future. A future is a value that
implements the [`std::future::Future`][trait] trait provided by the standard
library. They are values that contain the in-progress asynchronous computation.

The [`std::future::Future`][trait] trait definition is:

```rust
use std::pin::Pin;
use std::task::{Context, Poll};

pub trait Future {
    type Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context)
        -> Poll<Self::Output>;
}
```

The [associated type][assoc] `Output` is the type that the future produces once
it completes. The [`Pin`][pin] type is how Rust is able to support borrows in
`async` functions. See the [standard library][pin] documentation for more
details.

Unlike how futures are implemented in other languages, a Rust future does not
represent a computation happening in the background, rather the Rust future
**is** the computation itself. The owner of the future is responsible for
advancing the computation by polling the future. This is done by calling
`Future::poll`.

## Implementing `Future`

Let's implement a very simple future. This future will:

1. Wait until a specific instant in time.
2. Output some text to STDOUT.
3. Yield a string.

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

struct Delay {
    when: Instant,
}

impl Future for Delay {
    type Output = &'static str;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<&'static str>
    {
        if Instant::now() >= self.when {
            println!("Hello world");
            Poll::Ready("done")
        } else {
            // Ignore this line for now.
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}

#[tokio::main]
async fn main() {
    let when = Instant::now() + Duration::from_millis(10);
    let future = Delay { when };

    let out = future.await;
    assert_eq!(out, "done");
}
```

## Async fn as a Future

In the main function, we instantiate the future and call `.await` on it. From
async functions, we may call `.await` on any value that implements `Future`. In
turn, calling an `async` function returns an anonymous type that implements
`Future`. In the case of `async fn main()`, the generated future is roughly:

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

enum MainFuture {
    // Initialized, never polled
    State0,
    // Waiting on `Delay`, i.e. the `future.await` line.
    State1(Delay),
    // The future has completed.
    Terminated,
}
# struct Delay { when: Instant };
# impl Future for Delay {
#     type Output = &'static str;
#     fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<&'static str> {
#         unimplemented!();
#     }
# }

impl Future for MainFuture {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<()>
    {
        use MainFuture::*;

        loop {
            match *self {
                State0 => {
                    let when = Instant::now() +
                        Duration::from_millis(10);
                    let future = Delay { when };
                    *self = State1(future);
                }
                State1(ref mut my_future) => {
                    match Pin::new(my_future).poll(cx) {
                        Poll::Ready(out) => {
                            assert_eq!(out, "done");
                            *self = Terminated;
                            return Poll::Ready(());
                        }
                        Poll::Pending => {
                            return Poll::Pending;
                        }
                    }
                }
                Terminated => {
                    panic!("future polled after completion")
                }
            }
        }
    }
}
```

Rust futures are **state machines**. Here, `MainFuture` is represented as an
`enum` of the future's possible states. The future starts in the `State0` state.
When `poll` is invoked, the future attempts to advance its internal state as
much as possible. If the future is able to complete, `Poll::Ready` is returned
containing the output of the asynchronous computation.

If the future is **not** able to complete, usually due to resources it is
waiting on not being ready, then `Poll::Pending` is returned. Receiving
`Poll::Pending` indicates to the caller that the future will complete at a later
time and the caller should invoke `poll` again later.

We also see that futures are composed of other futures. Calling `poll` on the
outer future results in calling the inner future's `poll` function.

# Executors

Asynchronous Rust functions return futures. Futures must have `poll` called on
them to advance their state. Futures are composed of other futures. So, the
question is, what calls `poll` on the very most outer future?

Recall from earlier, to run asynchronous functions, they must either be
passed to `tokio::spawn` or be the main function annotated with
`#[tokio::main]`. This results in submitting the generated outer future to the
Tokio executor. The executor is responsible for calling `Future::poll` on the
outer future, driving the asynchronous computation to completion.

## Mini Tokio

To better understand how this all fits together, let's implement our own minimal
version of Tokio! The full code can be found [here][mini-tokio].

Add the following dependency to your `Cargo.toml` to pull in `futures`.

```toml
futures = "0.3"
```

```rust
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use futures::task;

fn main() {
    let mut mini_tokio = MiniTokio::new();

    mini_tokio.spawn(async {
        let when = Instant::now() + Duration::from_millis(10);
        let future = Delay { when };

        let out = future.await;
        assert_eq!(out, "done");
    });

    mini_tokio.run();
}
# struct Delay { when: Instant }
# impl Future for Delay {
#     type Output = &'static str;
#     fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<&'static str> {
#         Poll::Ready("done")
#     }
# }

struct MiniTokio {
    tasks: VecDeque<Task>,
}

type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

impl MiniTokio {
    fn new() -> MiniTokio {
        MiniTokio {
            tasks: VecDeque::new(),
        }
    }

    /// Spawn a future onto the mini-tokio instance.
    fn spawn<F>(&mut self, future: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.tasks.push_back(Box::pin(future));
    }

    fn run(&mut self) {
        let waker = task::noop_waker();
        let mut cx = Context::from_waker(&waker);

        while let Some(mut task) = self.tasks.pop_front() {
            if task.as_mut().poll(&mut cx).is_pending() {
                self.tasks.push_back(task);
            }
        }
    }
}
```

This runs the async block. A `Delay` instance is created with the requested
delay and is awaited on. However, our implementation so far has a major **flaw**.
Our executor never goes to sleep. The executor continuously loops **all**
spawned futures and polls them. Most of the time, the futures will not be ready
to perform more work and will return `Poll::Pending` again. The process will
burn CPU cycles and generally not be very efficient.

Ideally, we want mini-tokio to only poll futures when the future is able to make
progress. This happens when a resource that the task is blocked on becomes ready
to perform the requested operation. If the task wants to read data from a TCP
socket, then we only want to poll the task when the TCP socket has received
data. In our case, the task is blocked on the given `Instant` being reached.
Ideally, mini-tokio would only poll the task once that instant in time has
passed.

To achieve this, when a resource is polled, and the resource is **not** ready,
the resource will send a notification once it transitions into a ready state.

# Wakers

Wakers are the missing piece. This is the system by which a resource is able to
notify the waiting task that the resource has become ready to continue some
operation.

Let's look at the `Future::poll` definition again:

```rust,compile_fail
fn poll(self: Pin<&mut Self>, cx: &mut Context)
    -> Poll<Self::Output>;
```

The `Context` argument to `poll` has a `waker()` method. This method returns a
[`Waker`] bound to the current task. The [`Waker`] has a `wake()` method. Calling
this method signals to the executor that the associated task should be scheduled
for execution. Resources call `wake()` when they transition to a ready state to
notify the executor that polling the task will be able to make progress.

## Updating `Delay`

We can update `Delay` to use wakers:

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use std::thread;

struct Delay {
    when: Instant,
}

impl Future for Delay {
    type Output = &'static str;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<&'static str>
    {
        if Instant::now() >= self.when {
            println!("Hello world");
            Poll::Ready("done")
        } else {
            // Get a handle to the waker for the current task
            let waker = cx.waker().clone();
            let when = self.when;

            // Spawn a timer thread.
            thread::spawn(move || {
                let now = Instant::now();

                if now < when {
                    thread::sleep(when - now);
                }

                waker.wake();
            });

            Poll::Pending
        }
    }
}
```

Now, once the requested duration has elapsed, the calling task is notified and
the executor can ensure the task is scheduled again. The next step is to update
mini-tokio to listen for wake notifications.

There are still a few remaining issues with our `Delay` implementation. We will
fix them later.

> **warning**
> When a future returns `Poll::Pending`, it **must** ensure that the waker is
> signalled at some point. Forgetting to do this results in the task hanging
> indefinitely.
>
> Forgetting to wake a task after returning `Poll::Pending` is a common
> source of bugs.

Recall the first iteration of `Delay`. Here was the future implementation:

```rust
# use std::future::Future;
# use std::pin::Pin;
# use std::task::{Context, Poll};
# use std::time::Instant;
# struct Delay { when: Instant }
impl Future for Delay {
    type Output = &'static str;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<&'static str>
    {
        if Instant::now() >= self.when {
            println!("Hello world");
            Poll::Ready("done")
        } else {
            // Ignore this line for now.
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }
}
```

Before returning `Poll::Pending`, we called `cx.waker().wake_by_ref()`. This is
to satisfy the future contract. By returning `Poll::Pending`, we are responsible
for signalling the waker. Because we didn't implement the timer thread yet, we
signalled the waker inline. Doing so will result in the future being immediately
re-scheduled, executed again, and probably not be ready to complete.

Notice that you are allowed to signal the waker more often than necessary. In
this particular case, we signal the waker even though we are not ready to
continue the operation at all. There is nothing wrong with this besides some
wasted CPU cycles. However, this particular implementation will result in a busy
loop.

## Updating Mini Tokio

The next step is updating Mini Tokio to receive waker notifications. We want the
executor to only run tasks when they are woken, and to do this, Mini Tokio will
provide its own waker. When the waker is invoked, its associated task is queued
to be executed. Mini-Tokio passes this waker to the future when it polls the
future.

The updated Mini Tokio will use a channel to store scheduled tasks. Channels
allow tasks to be queued for execution from any thread. Wakers must be `Send`
and `Sync`.

> **info**
> The `Send` and `Sync` traits are marker traits related to concurrency
> provided by Rust. Types that can be **sent** to a different thread are
> `Send`. Most types are `Send`, but something like [`Rc`] is not. Types
> that can be **concurrently** accessed through immutable references are
> `Sync`. A type can be `Send` but not `Sync` — a good example is
> [`Cell`], which can be modified through an immutable reference, and
> is thus not safe to access concurrently.
>
> For more details, see the related [chapter in the Rust book][ch].

[`Rc`]: https://doc.rust-lang.org/std/rc/struct.Rc.html
[`Cell`]: https://doc.rust-lang.org/std/cell/struct.Cell.html
[ch]: https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html

Update the `MiniTokio` struct.

```rust
use std::sync::mpsc;
use std::sync::Arc;

struct MiniTokio {
    scheduled: mpsc::Receiver<Arc<Task>>,
    sender: mpsc::Sender<Arc<Task>>,
}

struct Task {
    // This will be filled in soon.
}
```

Wakers are `Sync` and can be cloned. When `wake` is called, the task must be
scheduled for execution. To implement this, we have a channel. When the `wake()`
is called on the waker, the task is pushed into the send half of the channel.
Our `Task` structure will implement the wake logic. To do this, it needs to
contain both the spawned future and the channel send half. We place the future
in a `TaskFuture` struct alongside a `Poll` enum to keep track of the latest
`Future::poll()` result, which is needed to handle spurious wake-ups. More
details are given in the implementation of the `poll()` method in `TaskFuture`.

```rust
# use std::future::Future;
# use std::pin::Pin;
# use std::sync::mpsc;
# use std::task::Poll;
use std::sync::{Arc, Mutex};

/// A structure holding a future and the result of
/// the latest call to its `poll` method.
struct TaskFuture {
    future: Pin<Box<dyn Future<Output = ()> + Send>>,
    poll: Poll<()>,
}

struct Task {
    // The `Mutex` is to make `Task` implement `Sync`. Only
    // one thread accesses `task_future` at any given time.
    // The `Mutex` is not required for correctness. Real Tokio
    // does not use a mutex here, but real Tokio has
    // more lines of code than can fit in a single tutorial
    // page.
    task_future: Mutex<TaskFuture>,
    executor: mpsc::Sender<Arc<Task>>,
}

impl Task {
    fn schedule(self: &Arc<Self>) {
        self.executor.send(self.clone());
    }
}
```

To schedule the task, the `Arc` is cloned and sent through the channel. Now, we
need to hook our `schedule` function with [`std::task::Waker`][`Waker`]. The
standard library provides a low-level API to do this using [manual vtable
construction][vtable]. This strategy provides maximum flexibility to
implementors, but requires a bunch of unsafe boilerplate code. Instead of using
[`RawWakerVTable`][vtable] directly, we will use the [`ArcWake`] utility
provided by the [`futures`] crate. This allows us to implement a simple trait to
expose our `Task` struct as a waker.

If you haven't already, add the following dependency to your `Cargo.toml` to pull in `futures`.

```toml
futures = "0.3"
```

Then implement [`futures::task::ArcWake`][`ArcWake`].

```rust
use futures::task::{self, ArcWake};
use std::sync::Arc;
# struct Task {}
# impl Task {
#     fn schedule(self: &Arc<Self>) {}
# }
impl ArcWake for Task {
    fn wake_by_ref(arc_self: &Arc<Self>) {
        arc_self.schedule();
    }
}
```

When the timer thread above calls `waker.wake()`, the task is pushed into the
channel. Next, we implement receiving and executing the tasks in the
`MiniTokio::run()` function.

```rust
# use std::sync::mpsc;
# use futures::task::{self, ArcWake};
# use std::future::Future;
# use std::pin::Pin;
# use std::sync::{Arc, Mutex};
# use std::task::{Context, Poll};
# struct MiniTokio {
#   scheduled: mpsc::Receiver<Arc<Task>>,
#   sender: mpsc::Sender<Arc<Task>>,
# }
# struct TaskFuture {
#     future: Pin<Box<dyn Future<Output = ()> + Send>>,
#     poll: Poll<()>,
# }
# struct Task {
#   task_future: Mutex<TaskFuture>,
#   executor: mpsc::Sender<Arc<Task>>,
# }
# impl ArcWake for Task {
#   fn wake_by_ref(arc_self: &Arc<Self>) {}
# }
impl MiniTokio {
    fn run(&self) {
        while let Ok(task) = self.scheduled.recv() {
            task.poll();
        }
    }

    /// Initialize a new mini-tokio instance.
    fn new() -> MiniTokio {
        let (sender, scheduled) = mpsc::channel();

        MiniTokio { scheduled, sender }
    }

    /// Spawn a future onto the mini-tokio instance.
    ///
    /// The given future is wrapped with the `Task` harness and pushed into the
    /// `scheduled` queue. The future will be executed when `run` is called.
    fn spawn<F>(&self, future: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        Task::spawn(future, &self.sender);
    }
}

impl TaskFuture {
    fn new(future: impl Future<Output = ()> + Send + 'static) -> TaskFuture {
        TaskFuture {
            future: Box::pin(future),
            poll: Poll::Pending,
        }
    }

    fn poll(&mut self, cx: &mut Context<'_>) {
        // Spurious wake-ups are allowed, even after a future has                                  
        // returned `Ready`. However, polling a future which has                                   
        // already returned `Ready` is *not* allowed. For this                                     
        // reason we need to check that the future is still pending                                
        // before we call it. Failure to do so can lead to a panic.
        if self.poll.is_pending() {
            self.poll = self.future.as_mut().poll(cx);
        }
    }
}

impl Task {
    fn poll(self: Arc<Self>) {
        // Create a waker from the `Task` instance. This
        // uses the `ArcWake` impl from above.
        let waker = task::waker(self.clone());
        let mut cx = Context::from_waker(&waker);

        // No other thread ever tries to lock the task_future
        let mut task_future = self.task_future.try_lock().unwrap();

        // Poll the inner future
        task_future.poll(&mut cx);
    }

    // Spawns a new task with the given future.
    //
    // Initializes a new Task harness containing the given future and pushes it
    // onto `sender`. The receiver half of the channel will get the task and
    // execute it.
    fn spawn<F>(future: F, sender: &mpsc::Sender<Arc<Task>>)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let task = Arc::new(Task {
            task_future: Mutex::new(TaskFuture::new(future)),
            executor: sender.clone(),
        });

        let _ = sender.send(task);
    }
}
```

Multiple things are happening here. First, `MiniTokio::run()` is implemented.
The function runs in a loop receiving scheduled tasks from the channel.
As tasks are pushed into the channel when they are woken, these tasks are able
to make progress when executed.

Additionally, the `MiniTokio::new()` and `MiniTokio::spawn()` functions are
adjusted to use a channel rather than a `VecDeque`. When new tasks are spawned,
they are given a clone of the sender-part of the channel, which the task can
use to schedule itself on the runtime.

The `Task::poll()` function creates the waker using the [`ArcWake`] utility from
the `futures` crate. The waker is used to create a `task::Context`. That
`task::Context` is passed to `poll`.

# Summary

We have now seen an end-to-end example of how asynchronous Rust works. Rust's
`async/await` feature is backed by traits. This allows third-party crates, like
Tokio, to provide the execution details.

* Asynchronous Rust operations are lazy and require a caller to poll them.
* Wakers are passed to futures to link a future to the task calling it.
* When a resource is **not** ready to complete an operation, `Poll::Pending` is
  returned and the task's waker is recorded.
* When the resource becomes ready, the task's waker is notified.
* The executor receives the notification and schedules the task to execute.
* The task is polled again, this time the resource is ready and the task makes
  progress.

# A few loose ends

Recall when we were implementing the `Delay` future, we said there were a few
more things to fix. Rust's asynchronous model allows a single future to migrate
across tasks while it executes. Consider the following:

```rust
use futures::future::poll_fn;
use std::future::Future;
use std::pin::Pin;
# use std::task::{Context, Poll};
# use std::time::{Duration, Instant};
# struct Delay { when: Instant }
# impl Future for Delay {
#   type Output = ();
#   fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<()> {
#       Poll::Pending
#   }
# }

#[tokio::main]
async fn main() {
    let when = Instant::now() + Duration::from_millis(10);
    let mut delay = Some(Delay { when });

    poll_fn(move |cx| {
        let mut delay = delay.take().unwrap();
        let res = Pin::new(&mut delay).poll(cx);
        assert!(res.is_pending());
        tokio::spawn(async move {
            delay.await;
        });

        Poll::Ready(())
    }).await;
}
```

The `poll_fn` function creates a `Future` instance using a closure. The snippet
above creates a `Delay` instance, polls it once, then sends the `Delay` instance
to a new task where it is awaited. In this example, `Delay::poll` is called more
than once with **different** `Waker` instances. When this happens, you must make
sure to call `wake` on the `Waker` passed to _the most recent_ call to `poll`.

When implementing a future, it is critical to assume that each call to `poll`
**could** supply a different `Waker` instance. The poll function must update any
previously recorded waker with the new one.

Our earlier implementation of `Delay` spawned a new thread every time it was
polled. This is fine, but can be very inefficient if it is polled too often
(e.g. if you `select!` over that future and some other future, both are polled
whenever either has an event). One approach to this is to remember whether you
have already spawned a thread, and only spawn a new thread if you haven't
already spawned one.  However if you do this, you must ensure that the thread's
`Waker` is updated on later calls to poll, as you are otherwise not waking the
most recent `Waker`.

To fix our earlier implementation, we could do something like this:

```rust
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::thread;
use std::time::{Duration, Instant};

struct Delay {
    when: Instant,
    // This is Some when we have spawned a thread, and None otherwise.
    waker: Option<Arc<Mutex<Waker>>>,
}

impl Future for Delay {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        // Check the current instant. If the duration has elapsed, then
        // this future has completed so we return `Poll::Ready`.
        if Instant::now() >= self.when {
            return Poll::Ready(());
        }

        // The duration has not elapsed. If this is the first time the future
        // is called, spawn the timer thread. If the timer thread is already
        // running, ensure the stored `Waker` matches the current task's waker.
        if let Some(waker) = &self.waker {
            let mut waker = waker.lock().unwrap();

            // Check if the stored waker matches the current task's waker.
            // This is necessary as the `Delay` future instance may move to
            // a different task between calls to `poll`. If this happens, the
            // waker contained by the given `Context` will differ and we
            // must update our stored waker to reflect this change.
            if !waker.will_wake(cx.waker()) {
                *waker = cx.waker().clone();
            }
        } else {
            let when = self.when;
            let waker = Arc::new(Mutex::new(cx.waker().clone()));
            self.waker = Some(waker.clone());

            // This is the first time `poll` is called, spawn the timer thread.
            thread::spawn(move || {
                let now = Instant::now();

                if now < when {
                    thread::sleep(when - now);
                }

                // The duration has elapsed. Notify the caller by invoking
                // the waker.
                let waker = waker.lock().unwrap();
                waker.wake_by_ref();
            });
        }

        // By now, the waker is stored and the timer thread is started.
        // The duration has not elapsed (recall that we checked for this
        // first thing), ergo the future has not completed so we must
        // return `Poll::Pending`.
        //
        // The `Future` trait contract requires that when `Pending` is
        // returned, the future ensures that the given waker is signalled
        // once the future should be polled again. In our case, by
        // returning `Pending` here, we are promising that we will
        // invoke the given waker included in the `Context` argument
        // once the requested duration has elapsed. We ensure this by
        // spawning the timer thread above.
        //
        // If we forget to invoke the waker, the task will hang
        // indefinitely.
        Poll::Pending
    }
}
```

It is a bit involved, but the idea is, on each call to `poll`, the future checks
if the supplied waker matches the previously recorded waker. If the two wakers
match, then there is nothing else to do. If they do not match, then the recorded
waker must be updated.

## `Notify` utility

We demonstrated how a `Delay` future could be implemented by hand using wakers.
Wakers are the foundation of how asynchronous Rust works. Usually, it is not
necessary to drop down to that level. For example, in the case of `Delay`, we
could implement it entirely with `async/await` by using the
[`tokio::sync::Notify`][notify] utility. This utility provides a basic task
notification mechanism. It handles the details of wakers, including making sure
that the recorded waker matches the current task.

Using [`Notify`][notify], we can implement a `delay` function using
`async/await` like this:

```rust
use tokio::sync::Notify;
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::thread;

async fn delay(dur: Duration) {
    let when = Instant::now() + dur;
    let notify = Arc::new(Notify::new());
    let notify_clone = notify.clone();

    thread::spawn(move || {
        let now = Instant::now();

        if now < when {
            thread::sleep(when - now);
        }

        notify_clone.notify_one();
    });


    notify.notified().await;
}
```

[assoc]: https://doc.rust-lang.org/book/ch19-03-advanced-traits.html#specifying-placeholder-types-in-trait-definitions-with-associated-types
[trait]: https://doc.rust-lang.org/std/future/trait.Future.html
[pin]: https://doc.rust-lang.org/std/pin/index.html
[`Waker`]: https://doc.rust-lang.org/std/task/struct.Waker.html
[mini-tokio]: https://github.com/tokio-rs/website/blob/master/tutorial-code/mini-tokio/src/main.rs
[vtable]: https://doc.rust-lang.org/std/task/struct.RawWakerVTable.html
[`ArcWake`]: https://docs.rs/futures/0.3/futures/task/trait.ArcWake.html
[`futures`]: https://docs.rs/futures/
[notify]: https://docs.rs/tokio/1/tokio/sync/struct.Notify.html
