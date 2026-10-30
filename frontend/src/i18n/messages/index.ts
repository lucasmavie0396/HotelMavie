import { app } from './app';
import { common } from './common';
import { front } from './front';
import { posViews } from './pos';
import { publicSite } from './public';
import { roomsViews } from './rooms';

const modules = [common, app, publicSite, front, roomsViews, posViews];

type Tree = Record<string, string>;

function merge(locale: 'pt' | 'en') {
  return modules.reduce<Tree>((all, module) => ({ ...all, ...(module[locale] as unknown as Tree) }), {});
}

export const messages = { pt: merge('pt'), en: merge('en') };
