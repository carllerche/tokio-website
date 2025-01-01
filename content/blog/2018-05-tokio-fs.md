---
date: "2018-05-02"
title: "New Tokio release, now with filesystem support"
description: "May 5, 2018"
---

It took a bit longer than I had initially hoped (as it always does), but a new
Tokio version has been released. This release includes, among other features, a
new [set of APIs][fs] that allow performing filesystem operations from an
asynchronous context.

## Filesystem APIs

Interacting with files (and other filesystem types) requires\* blocking system
calls and we all know that blocking and asynchronous do not mix. So,
historically, when people ask "how do I read from and write to files?", the
answer is to use a thread pool. The idea is that when a blocking read or write
must be performed, it is done on a thread pool so that it does not block the
asynchronous reactor.

Requiring a separate thread pool for performing file operations requires message
passing. The asynchronous task must send a message to the thread pool asking it
to do a read from the file, the thread pool does the read and fills a buffer
with the result. Then the thread pool sends the buffer back to the asynchronous
task. Not only does this add the overhead for dispatching messages, but it also
requires allocating buffers to send the data back and forth.

Now, with Tokio's new [filesystem APIs][fs], this message passing overhead is no
longer needed. A new [`File`] type is added. This type looks very similar to the
type provided by `std`, but it implements `AsyncRead` and `AsyncWrite`, making
it safe to use _directly_ from an asynchronous task running on the Tokio
runtime.

Because the [`File`] type implements `AsyncRead` and `AsyncWrite`, it can be
used in much the same way that a TCP socket would be used from Tokio.

As of today, the filesystem APIs are pretty minimal. There are many other APIs
that need to be implemented to bring the Tokio filesystem APIs in line with
`std`, but those are left as an exercise to the reader to submit as PRs!

\* Yes, there are some operating systems that provide fully asynchronous
filesystem APIs, but these are either incomplete or not portable.

## Standard in and out

This release of Tokio also includes asynchronous [standard input][in] and
[standard output][out] APIs. Because it is difficult to provide true
asynchronous standard input and output in a portable way, the Tokio versions use
a similar strategy as the blocking file operation APIs.

## `blocking`

These new APIs are made possible thanks to a new [`blocking`] API that allows
annotating sections of code that will block the current thread. These blocking
sections can include blocking system calls, waiting on mutexes, or CPU heavy
computations.

By informing the Tokio runtime that the current thread will block, the runtime
is able to move the event loop from the current thread to another thread,
freeing the current thread up to permit blocking.

This is the opposite of using message passing to run blocking operations on a
threadpool. Instead of moving the blocking operation to another thread, the
entire event loop is moved.

In practice, moving the event loop to another thread is much cheaper than moving
the blocking operation. Doing so only requires a few atomic operations. The
Tokio runtime also keeps a pool of standby threads ready to allow moving the
event loop as fast as possible.

This also means that using the `blocking` annotation and `tokio-fs` must be done
from the context of the Tokio runtime and not other futures aware executors.

## Current thread runtime

The release also includes a ["current thread"][rt] version of the runtime
(thanks [kpp](https://github.com/kpp)). This is similar to the existing runtime,
but runs all components on the current thread. This allows running futures that
do not implement `Send`.

[fs]: https://docs.rs/tokio/latest/tokio/fs/index.html
[`file`]: https://docs.rs/tokio/latest/tokio/fs/struct.File.html
[in]: https://docs.rs/tokio/latest/tokio/io/fn.stdin.html
[out]: https://docs.rs/tokio/latest/tokio/io/fn.stdout.html
[`blocking`]: https://docs.rs/tokio-threadpool/latest/tokio_threadpool/fn.blocking.html
[rt]: https://docs.rs/tokio/latest/tokio/runtime/current_thread/index.html
