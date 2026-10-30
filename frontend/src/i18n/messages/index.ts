import { app } from './app';
import { common } from './common';
import { publicSite } from './public';

const modules = [common, app, publicSite];

type Tree = Record<string, string>;

function merge(locale: 'pt' | 'en') {
  return modules.reduce<Tree>((all, module) => ({ ...all, ...(module[locale] as unknown as Tree) }), {});
}

export const messages = { pt: merge('pt'), en: merge('en') };
