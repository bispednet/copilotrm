import React from 'react';

type LinkItem = { href: string; label: string; external?: boolean };

export function TopHeader(props: { product: string; area: string; links: LinkItem[] }): JSX.Element {
  return (
    <header className="topHeader">
      <div className="topHeaderInner">
        <div className="brandMark">
          <span className="brandDot" />
          <div className="brandText">{props.product} <span className="brandSub">{props.area}</span></div>
        </div>
        <nav className="topLinks">
          {props.links.map((l) => (
            <a key={l.href + l.label} href={l.href} target={l.external ? '_blank' : undefined} rel={l.external ? 'noreferrer' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function FooterBar(props: { text: string; links: LinkItem[] }): JSX.Element {
  return (
    <footer className="footerBar">
      <div className="footerInner">
        <span>{props.text}</span>
        <div className="footerLinks">
          {props.links.map((l) => (
            <a key={l.href + l.label} href={l.href} target={l.external ? '_blank' : undefined} rel={l.external ? 'noreferrer' : undefined}>
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
