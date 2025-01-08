---
title: "Shared state"
---

So far, we have a key-value server working. However, there is a major flaw:
state is not shared across connections. We will fix that in this article.

# Strategies

There are a couple of different ways to share state in Tokio.

1. Guard the shared state with a Mutex.
2. Spawn a task to manage the state and use message passing to operate on it.

Generally you want to use the first approach for simple data, and the second
approach for things that require asynchronous work such as I/O primitives.  In
this chapter, the shared state is a `HashMap` and the operations are `insert`
and `get`. Neither of these operations is asynchronous, so we will use a
`Mutex`.

The latter approach is covered in the next chapter.

# Add `bytes` dependency

Instead of using `Vec<u8>`, the Mini-Redis crate uses `Bytes` from the [`bytes`]
crate. The goal of `Bytes` is to provide a robust byte array structure for
network programming. The biggest feature it adds over `Vec<u8>` is shallow
cloning. In other words, calling `clone()` on a `Bytes` instance does not copy
the underlying data. Instead, a `Bytes` instance is a reference-counted handle
to some underlying data. The `Bytes` type is roughly an `Arc<Vec<u8>>` but with
some added capabilities.

Add the `bytes` dependency to your `Cargo.toml` file:

```bash
cargo add bytes
```

[`bytes`]: https://docs.rs/bytes/1/bytes/struct.Bytes.html

# Initialize the `HashMap`

The `HashMap` will be shared across many tasks and potentially many threads. To
support this, it is wrapped in `Arc<Mutex<_>>`.

First, for convenience, add the following type alias after the `use` statements.

```rust
use bytes::Bytes;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

type Db = Arc<Mutex<HashMap<String, Bytes>>>;
```

Then, update the `main` function to initialize the `HashMap` and pass an `Arc`
**handle** to the `process` function. Using `Arc` allows the `HashMap` to be
referenced concurrently from many tasks, potentially running on many threads.
Throughout Tokio, the term **handle** is used to reference a value that provides
access to some shared state.

```rust
use tokio::net::TcpListener;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

# fn dox() {
#[tokio::main]
async fn main() {
    let listener = TcpListener::bind("127.0.0.1:6379").await.unwrap();

    println!("Listening");

    let db = Arc::new(Mutex::new(HashMap::new()));

    loop {
        let (socket, _) = listener.accept().await.unwrap();
        // Clone the handle to the hash map.
        let db = db.clone();

        println!("Accepted");
        tokio::spawn(async move {
            process(socket, db).await;
        });
    }
}
# }
# type Db = Arc<Mutex<HashMap<(), ()>>>;
# async fn process(_: tokio::net::TcpStream, _: Db) {}
```

## On using `std::sync::Mutex` and `tokio::sync::Mutex`

Note that `std::sync::Mutex` and **not** `tokio::sync::Mutex` is used to guard
the `HashMap`. A common error is to unconditionally use `tokio::sync::Mutex`
from within async code. An async mutex is a mutex that is locked across calls
to `.await`.

A synchronous mutex will block the current thread when waiting to acquire the
lock. This, in turn, will block other tasks from processing. However, switching
to `tokio::sync::Mutex` usually does not help as the asynchronous mutex uses a
synchronous mutex internally.

As a rule of thumb, using a synchronous mutex from within asynchronous code is
fine as long as contention remains low and the lock is not held across calls to
`.await`.

# Update `process()`

The process function no longer initializes a `HashMap`. Instead, it takes the
shared handle to the `HashMap` as an argument. It also needs to lock the
`HashMap` before using it. Remember that the value's type for the `HashMap` is
now `Bytes` (which we can cheaply clone), so this needs to be changed as well.

```rust
use tokio::net::TcpStream;
use mini_redis::{Connection, Frame};
# use std::collections::HashMap;
# use std::sync::{Arc, Mutex};
# type Db = Arc<Mutex<HashMap<String, bytes::Bytes>>>;

async fn process(socket: TcpStream, db: Db) {
    use mini_redis::Command::{self, Get, Set};

    // Connection, provided by `mini-redis`, handles parsing frames from
    // the socket
    let mut connection = Connection::new(socket);

    while let Some(frame) = connection.read_frame().await.unwrap() {
        let response = match Command::from_frame(frame).unwrap() {
            Set(cmd) => {
                let mut db = db.lock().unwrap();
                db.insert(cmd.key().to_string(), cmd.value().clone());
                Frame::Simple("OK".to_string())
            }           
            Get(cmd) => {
                let db = db.lock().unwrap();
                if let Some(value) = db.get(cmd.key()) {
                    Frame::Bulk(value.clone())
                } else {
                    Frame::Null
                }
            }
            cmd => panic!("unimplemented {:?}", cmd),
        };

        // Write the response to the client
        connection.write_frame(&response).await.unwrap();
    }
}
```

# Holding a `MutexGuard` across an `.await`

You might write code that looks like this:

```rust
use std::sync::{Mutex, MutexGuard};

async fn increment_and_do_stuff(mutex: &Mutex<i32>) {
    let mut lock: MutexGuard<i32> = mutex.lock().unwrap();
    *lock += 1;

    do_something_async().await;
} // lock goes out of scope here
# async fn do_something_async() {}
```

When you try to spawn something that calls this function, you will encounter the
following error message:

```text
error: future cannot be sent between threads safely
   --> src/lib.rs:13:5
    |
13  |     tokio::spawn(async move {
    |     ^^^^^^^^^^^^ future created by async block is not `Send`
    |
   ::: /playground/.cargo/registry/src/github.com-1ecc6299db9ec823/tokio-0.2.21/src/task/spawn.rs:127:21
    |
127 |         T: Future + Send + 'static,
    |                     ---- required by this bound in `tokio::task::spawn::spawn`
    |
    = help: within `impl std::future::Future`, the trait `std::marker::Send` is not implemented for `std::sync::MutexGuard<'_, i32>`
note: future is not `Send` as this value is used across an await
   --> src/lib.rs:7:5
    |
4   |     let mut lock: MutexGuard<i32> = mutex.lock().unwrap();
    |         -------- has type `std::sync::MutexGuard<'_, i32>` which is not `Send`
...
7   |     do_something_async().await;
    |     ^^^^^^^^^^^^^^^^^^^^^^^^^^ await occurs here, with `mut lock` maybe used later
8   | }
    | - `mut lock` is later dropped here
```

This happens because the `std::sync::MutexGuard` type is **not** `Send`. This
means that you can't send a mutex lock to another thread, and the error happens
because the Tokio runtime can move a task between threads at every `.await`.
To avoid this, you should restructure your code such that the mutex lock's
destructor runs before the `.await`.

```rust
# use std::sync::{Mutex, MutexGuard};
// This works!
async fn increment_and_do_stuff(mutex: &Mutex<i32>) {
    {
        let mut lock: MutexGuard<i32> = mutex.lock().unwrap();
        *lock += 1;
    } // lock goes out of scope here

    do_something_async().await;
}
# async fn do_something_async() {}
```

Note that this does not work:

```rust
use std::sync::{Mutex, MutexGuard};

// This fails too.
async fn increment_and_do_stuff(mutex: &Mutex<i32>) {
    let mut lock: MutexGuard<i32> = mutex.lock().unwrap();
    *lock += 1;
    drop(lock);

    do_something_async().await;
}
# async fn do_something_async() {}
```

This is because the compiler currently calculates whether a future is `Send`
based on scope information only. The compiler will hopefully be updated to
support explicitly dropping it in the future, but for now, you must explicitly
use a scope.

Note that the error discussed here is also discussed in the [Send bound section
from the spawning chapter][send-bound].

You should not try to circumvent this issue by spawning the task in a way that
does not require it to be `Send`, because if Tokio suspends your task at an
`.await` while the task is holding the lock, some other task may be scheduled to
run on the same thread, and this other task may also try to lock that mutex,
which would result in a deadlock as the task waiting to lock the mutex would
prevent the task holding the mutex from releasing the mutex.

Keep in mind that some mutex crates implement `Send` for their MutexGuards.
In this case, there is no compiler error, even if you hold a MutexGuard across
an `.await`. The code compiles, but it deadlocks!

We will discuss some approaches to avoid these issues below:

[send-bound]: spawning#send-bound

## Restructure your code to not hold the lock across an `.await`

The safest way to handle a mutex is to wrap it in a struct, and lock the mutex
only inside non-async methods on that struct.

```rust
use std::sync::Mutex;

struct CanIncrement {
    mutex: Mutex<i32>,
}
impl CanIncrement {
    // This function is not marked async.
    fn increment(&self) {
        let mut lock = self.mutex.lock().unwrap();
        *lock += 1;
    }
}

async fn increment_and_do_stuff(can_incr: &CanIncrement) {
    can_incr.increment();
    do_something_async().await;
}
# async fn do_something_async() {}
```

This pattern guarantees that you won't run into the `Send` error, because the
mutex guard does not appear anywhere in an async function. It also protects you
from deadlocks, when using crates whose `MutexGuard` implements `Send`.

You can find a more detailed example [in this blog post][shared-mutable-state-blog-post].

## Spawn a task to manage the state and use message passing to operate on it

This is the second approach mentioned in the start of this chapter, and is often
used when the shared resource is an I/O resource. See the next chapter for more
details.

## Use Tokio's asynchronous mutex

The [`tokio::sync::Mutex`] type provided by Tokio can also be used. The primary
feature of the Tokio mutex is that it can be held across an `.await` without any
issues. That said, an asynchronous mutex is more expensive than an ordinary
mutex, and it is typically better to use one of the two other approaches.

```rust
use tokio::sync::Mutex; // note! This uses the Tokio mutex

// This compiles!
// (but restructuring the code would be better in this case)
async fn increment_and_do_stuff(mutex: &Mutex<i32>) {
    let mut lock = mutex.lock().await;
    *lock += 1;

    do_something_async().await;
} // lock goes out of scope here
# async fn do_something_async() {}
```

[`tokio::sync::Mutex`]: https://docs.rs/tokio/1/tokio/sync/struct.Mutex.html

# Tasks, threads, and contention

Using a blocking mutex to guard short critical sections is an acceptable
strategy when contention is minimal. When a lock is contended, the thread
executing the task must block and wait on the mutex. This will not only block
the current task but it will also block all other tasks scheduled on the current
thread.

By default, the Tokio runtime uses a multi-threaded scheduler. Tasks are
scheduled on any number of threads managed by the runtime. If a large number of
tasks are scheduled to execute and they all require access to the mutex, then
there will be contention. On the other hand, if the
[`current_thread`][current_thread] runtime flavor is used, then the mutex will
never be contended.

> **info**
> The [`current_thread` runtime flavor][basic-rt] is a lightweight,
> single-threaded runtime. It is a good choice when only spawning
> a few tasks and opening a handful of sockets. For example, this
> option works well when providing a synchronous API bridge on top
> of an asynchronous client library.

[basic-rt]: https://docs.rs/tokio/1/tokio/runtime/struct.Builder.html#method.new_current_thread

If contention on a synchronous mutex becomes a problem, the best fix is rarely
to switch to the Tokio mutex. Instead, options to consider are to:

- Let a dedicated task manage state and use message passing.
- Shard the mutex.
- Restructure the code to avoid the mutex.

## Mutex sharding

In our case, as each *key* is independent, mutex sharding will work well. To do
this, instead of having a single `Mutex<HashMap<_, _>>` instance, we would
introduce `N` distinct instances.

```rust
# use std::collections::HashMap;
# use std::sync::{Arc, Mutex};
type ShardedDb = Arc<Vec<Mutex<HashMap<String, Vec<u8>>>>>;

fn new_sharded_db(num_shards: usize) -> ShardedDb {
    let mut db = Vec::with_capacity(num_shards);
    for _ in 0..num_shards {
        db.push(Mutex::new(HashMap::new()));
    }
    Arc::new(db)
}
```

Then, finding the cell for any given key becomes a two step process. First, the
key is used to identify which shard it is part of. Then, the key is looked up in
the `HashMap`.

```rust,compile_fail
let shard = db[hash(key) % db.len()].lock().unwrap();
shard.insert(key, value);
```

The simple implementation outlined above requires using a fixed number of
shards, and the number of shards cannot be changed once the sharded map is
created.

The [dashmap] crate provides an implementation of a more sophisticated
sharded hash map. You may also want to have a look at such concurrent hash table
implementations as [leapfrog] and [flurry], the latter being a port of Java's
`ConcurrentHashMap` data structure.

Before you start using any of these crates, be sure you structure your code so,
that you cannot hold a `MutexGuard` across an `.await`. If you don't, you will
either have compiler errors (in case of non-Send guards) or your code will
deadlock (in case of Send guards). See a full example and more context [in this blog post][shared-mutable-state-blog-post].

[current_thread]: https://docs.rs/tokio/1/tokio/runtime/index.html#current-thread-scheduler
[dashmap]: https://docs.rs/dashmap
[leapfrog]: https://docs.rs/leapfrog
[flurry]: https://docs.rs/flurry
[shared-mutable-state-blog-post]: https://draft.ryhl.io/blog/shared-mutable-state/
