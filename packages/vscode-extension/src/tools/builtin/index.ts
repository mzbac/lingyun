import * as vscode from 'vscode';

import { toolRegistry } from '../../core/registry';
import { bashHandler, bashTool } from './bash';
import { editHandler, editTool } from './edit';
import { globHandler, globTool } from './glob';
import { grepHandler, grepTool } from './grep';
import { listHandler, listTool } from './list';
import { lspHandler, lspTool } from './lsp';
import { readHandler, readTool } from './read';
import { readRangeHandler, readRangeTool } from './readRange';
import { symbolsPeekHandler, symbolsPeekTool, symbolsSearchHandler, symbolsSearchTool } from './symbols';
import { skillHandler, skillTool } from './skill';
import { taskHandler, taskTool } from './task';
import { todoreadHandler, todoreadTool } from './todoread';
import { todowriteHandler, todowriteTool } from './todowrite';
import { writeHandler, writeTool } from './write';

export function registerBuiltinTools(): vscode.Disposable[] {
  return [
    toolRegistry.registerTool(listTool, listHandler),
    toolRegistry.registerTool(globTool, globHandler),
    toolRegistry.registerTool(lspTool, lspHandler),
    toolRegistry.registerTool(symbolsSearchTool, symbolsSearchHandler),
    toolRegistry.registerTool(symbolsPeekTool, symbolsPeekHandler),
    toolRegistry.registerTool(grepTool, grepHandler),
    toolRegistry.registerTool(readTool, readHandler),
    toolRegistry.registerTool(readRangeTool, readRangeHandler),
    toolRegistry.registerTool(writeTool, writeHandler),
    toolRegistry.registerTool(editTool, editHandler),
    toolRegistry.registerTool(bashTool, bashHandler),
    toolRegistry.registerTool(skillTool, skillHandler),
    toolRegistry.registerTool(taskTool, taskHandler),
    toolRegistry.registerTool(todoreadTool, todoreadHandler),
    toolRegistry.registerTool(todowriteTool, todowriteHandler),
  ];
}
