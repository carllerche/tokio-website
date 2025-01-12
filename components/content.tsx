import Menu from "./menu";
import { DiscordIcon, GitHubIcon } from "./icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

function Footer({ next, prev, mdPath }) {
  let edit = `https://github.com/tokio-rs/website/edit/master/content/${mdPath}`;
  return (
    <div className="tk-doc-footer is-hidden-print">
      <div className="level">
        <div className="level-left">
          <div className="level-item tk-prev">
            {prev && (
              <a href={prev.href} rel="prev">
                <span className="tk-arrow" style={{ marginRight: "0.5rem" }}>
                  <img src="/img/arrow-left.svg" />
                </span>
                {prev.title}
              </a>
            )}
          </div>
        </div>
        <div className="level-right">
          <div className="level-item tk-next">
            {next && (
              <a href={next.href} rel="next">
                {next.title}
                <span className="tk-arrow" style={{ marginLeft: "0.5rem" }}>
                  <img src="/img/arrow-right.svg" />
                </span>
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="level">
        <div className="level-left">
          <div className="level-item tk-help-links">
            <p>
              Get Help:
              <a href="https://github.com/tokio-rs/tokio/discussions">
                <GitHubIcon className="is-medium" />
              </a>
              <a href="https://discord.gg/tokio">
                <DiscordIcon className="is-medium" />
              </a>
            </p>
          </div>
        </div>
        <div className="level-right">
          <div className="level-item tk-edit-this-page">
            <a href={edit}>Edit this page</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function insertHeading(heading, menu, level = 1) {
  if (level == heading.level || menu.length == 0) {
    menu.push({
      heading,
      nested: [],
    });
  } else {
    insertHeading(heading, menu[menu.length - 1].nested, level + 1);
  }
}

function TableOfContents({ headings }) {
  const list = useMemo(() => {
    let menu = [];
    for (const heading of headings) {
      insertHeading(heading, menu);
    }

    return menu.map((entry) => {
      const heading = entry.heading;

      let nested = entry.nested.map((entry) => {
        const heading = entry.heading;

        return (
          <li key={heading.slug}>
            <a href={`#${heading.slug}`}>{heading.title}</a>
          </li>
        );
      });

      return (
        <li key={heading.slug}>
          <a href={`#${heading.slug}`}>{heading.title}</a>
          {entry.nested.length > 0 && <ul>{nested}</ul>}
        </li>
      );
    });
  }, [headings]);

  return (
    <aside className="column is-one-third tk-content-summary is-hidden-print">
      <ul className="tk-content-summary-menu">{list}</ul>
    </aside>
  );
}

export default function Content({
  menu,
  href,
  title,
  next,
  prev,
  body,
  mdPath,
  description,
}) {
  const isBlogRoute = href.startsWith("/blog");

  const [headings, setHeadings] = useState([]);
  const mdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mdRef.current?.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
      const level = Number(el.tagName.slice(-1));
      const title = el.textContent;
      const slug = el.id;
      setHeadings((headings) => [...headings, { level, title, slug }]);
    });
    return () => {
      setHeadings([]);
    };
  }, [mdRef]);

  return (
    <>
      <div className="columns is-marginless tk-docs">
        <div className="column is-one-quarter tk-docs-nav is-hidden-print">
          <Menu href={href} menu={menu}>
            {isBlogRoute && (
              <div className="all-posts-link">
                <Link href="/blog">More Blog Posts</Link>
              </div>
            )}
          </Menu>
        </div>
        <div className="column is-three-quarters tk-content">
          <section className="section content">
            <div className="columns">
              <div className="column is-two-thirds tk-markdown" ref={mdRef}>
                <h1
                  className={`title ${isBlogRoute ? "blog-title" : ""}`}
                  id=""
                >
                  {title}
                </h1>
                {isBlogRoute && <p className="description">{description}</p>}
                <div dangerouslySetInnerHTML={{ __html: body }}></div>
                <Footer next={next} prev={prev} mdPath={mdPath} />
              </div>
              <TableOfContents headings={headings} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
