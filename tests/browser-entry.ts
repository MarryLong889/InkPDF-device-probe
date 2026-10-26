import Probe from '../src/main';
import { readFiles, app, notices } from './obsidian-mock';
const plugin = new Probe();
Object.assign(window, { plugin, readFiles, mockApp: app, notices });
await plugin.onload();
await plugin.open(false);
