const DEFAULT_ICON = '/favicon.svg';

function link() {
  let element = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'icon';
    document.head.appendChild(element);
  }
  return element;
}

export function setFavicon(url?: string | null) {
  const element = link();
  const href = url || DEFAULT_ICON;
  if (element.getAttribute('href') === href) return;
  element.href = href;
  element.type = href.endsWith('.svg') ? 'image/svg+xml' : '';
  let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!apple) {
    apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    document.head.appendChild(apple);
  }
  apple.href = href;
}

export function setPageIdentity(title: string, iconUrl?: string | null) {
  document.title = title;
  setFavicon(iconUrl);
}
