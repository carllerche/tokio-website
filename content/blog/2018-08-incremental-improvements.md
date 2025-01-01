---
date: "2018-08-24"
title: "Tokio 0.1.8 with many incremental improvements"
description: "August 24, 2018"
---

It took a bit longer than I had initially hoped (as it always does), but a new
Tokio version has been released. This release includes, among other features, a
new [set of APIs][fs] that allow performing filesystem operations from an
asynchronous context, concurrency improvements, timer improvements, and more
(including bug fixes, so be sure to update!).

It has been a little bit since the last post. There haven't been any big feature
releases, but that doesn't mean that we have been idle. New crates have been
released with many incremental improvements over the past few months. Many of
these improvements have been contributed by the community, so I thought a little
highlight was in order.

## Filesystem APIs

The initial release of `tokio-fs` was more of a stub than a full implementation.
It only included basic file system operations.

The latest release includes [non-blocking versions][fs] for most file system
APIs. This amazing work was contributed mostly by [@griff] in an [epic PR][pr]
and [@lnicola] in a series of smaller PRs, but many others participated to help
review and improve the crate.

Thanks goes to: [@dekellum], [@matsadler], [@debris], [@mati865], [@lovebug356],
[@bryanburgers], [@shepmaster].

[fs]: https://docs.rs/tokio/latest/tokio/fs/index.html
[pr]: https://github.com/tokio-rs/tokio/pull/494

## Concurrency improvements

Over the past couple months, [@stjepang] has been chugging along improving the
concurrency related bits of Tokio. Some highlights:

- [#459] - Fix a race in thread wakeup
- [#470] - Improve worker spinning
- [#517] - Improve scalability of a RW Lock used in the reactor.
- [#534] - Improve the stealing part of the work-stealing runtime.

We also had a good chat while he was in town for Rustconf, and I'm excited for
his work that is yet to come.

And of course, thanks for all the [crossbeam] work. Tokio heavily depends on it.

## `current_thread::Runtime`

The `current_thread::Runtime` has also received a number of incremental
improvements since it was initially introduced by [@vorner] and [@kpp].

[@sdroege] added a `Handle` that allows spawning tasks onto the runtime from
other threads ([#340]). This is implemented using a channel to send the task to
the runtime thread (a similar strategy that `tokio-core` used).

And [@jonhoo] implemented a `block_on_all` function ([#477]) and fixed a bug
with tracking the number of active futures and coordinating shutdown ([#478])

## Timer improvements

`tokio::timer` does get a new feature: [`DelayQueue`]. This type allows the user
to store values that get returned back after some period of time. This is useful
for supporting more complex time related cases.

Lets' take a cache as an example. The goal of a cache is to hold values
associated with a key for a certain amount of time. After the time elapses, the
value is dropped. It has always been possible to implement this with
[`tokio::timer::Delay`][delay], but is a bit challenging. When the cache has
many entries, all of them must be scanned to check if they need to be dropped.

With [`DelayQueue`], the implementation becomes more efficient:

[`delayqueue`]: https://docs.rs/tokio-timer/0.2.6/tokio_timer/struct.DelayQueue.html
[delay]: https://docs.rs/tokio-timer/0.2.6/tokio_timer/struct.Delay.html

```rust
#[macro_use]
extern crate futures;
extern crate tokio;
# type CacheKey = String;
# type Value = String;
use tokio::timer::{delay_queue, DelayQueue, Error};
use futures::{Async, Poll, Stream};
use std::collections::HashMap;
use std::time::Duration;

struct Cache {
    entries: HashMap<CacheKey, (Value, delay_queue::Key)>,
    expirations: DelayQueue<CacheKey>,
}

const TTL_SECS: u64 = 30;

impl Cache {
    fn insert(&mut self, key: CacheKey, value: Value) {
        let delay = self.expirations
            .insert(key.clone(), Duration::from_secs(TTL_SECS));

        self.entries.insert(key, (value, delay));
    }

    fn get(&self, key: &CacheKey) -> Option<&Value> {
        self.entries.get(key)
            .map(|&(ref v, _)| v)
    }

    fn remove(&mut self, key: &CacheKey) {
        if let Some((_, cache_key)) = self.entries.remove(key) {
            self.expirations.remove(&cache_key);
        }
    }

    fn poll_purge(&mut self) -> Poll<(), Error> {
        while let Some(entry) = try_ready!(self.expirations.poll()) {
            self.entries.remove(entry.get_ref());
        }

        Ok(Async::Ready(()))
    }
}
# fn main() {}
```

## Many other small improvements

Besides what has been listed above, Tokio has received many small improvements
and bug fixes across most of the crates. These have been provided by our amazing
community. I'm hoping that over time, more and more people will join the effort
of building Tokio and help it continue to evolve.

So, a big thanks to [all of you have have contributed][contrib] to Tokio to
date.

[contrib]: https://github.com/tokio-rs/tokio/graphs/contributors
[crossbeam]: https://github.com/crossbeam-rs/
[@dekellum]: https://github.com/dekellum
[@matsadler]: https://github.com/matsadler
[@debris]: https://github.com/debris
[@mati865]: https://github.com/mati865
[@lovebug356]: https://github.com/lovebug356
[@bryanburgers]: https://github.com/bryanburgers
[@shepmaster]: https://github.com/shepmaster
[@griff]: https://github.com/griff
[@lnicola]: https://github.com/lnicola
[@stjepang]: https://github.com/stjepang
[@kpp]: https://github.com/kpp
[@vorner]: https://github.com/vorner
[@sdroege]: https://github.com/sdroege
[@jonhoo]: https://github.com/jonhoo
[#340]: https://github.com/tokio-rs/tokio/issues/340
[#459]: https://github.com/tokio-rs/tokio/issues/459
[#470]: https://github.com/tokio-rs/tokio/issues/470
[#477]: https://github.com/tokio-rs/tokio/issues/477
[#479]: https://github.com/tokio-rs/tokio/issues/478
[#488]: https://github.com/tokio-rs/tokio/issues/488
[#517]: https://github.com/tokio-rs/tokio/issues/517
[#534]: https://github.com/tokio-rs/tokio/issues/534
