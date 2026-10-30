import { adminViews } from './admin';
import { app } from './app';
import { common } from './common';
import { financeViews } from './finance';
import { front } from './front';
import { posViews } from './pos';
import { publicSite } from './public';
import { roomsViews } from './rooms';
import { stockViews } from './stock';

const modules = [common, app, publicSite, front, roomsViews, posViews, stockViews, financeViews, adminViews];

type Tree = Record<string, string>;

function merge(locale: 'pt' | 'en') {
  return modules.reduce<Tree>((all, module) => ({ ...all, ...(module[locale] as unknown as Tree) }), {});
}

export const messages = { pt: merge('pt'), en: merge('en') };
