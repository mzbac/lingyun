import * as vscode from 'vscode';

import { toolRegistry } from '../../core/registry';
import { backgroundTerminalManager } from '../../core/terminal/backgroundTerminal';
import { bashHandler, bashTool } from './bash';
import { editHandler, editTool } from './edit';
import { globHandler, globTool } from './glob';
import { grepHandler, grepTool } from './grep';
import { createGoalHandler, createGoalTool, getGoalHandler, getGoalTool, updateGoalHandler, updateGoalTool } from './goal';
import { listHandler, listTool } from './list';
import { lspHandler, lspTool } from './lsp';
import { getMemoryHandler, getMemoryTool } from './getMemory';
import { maintainMemoryHandler, maintainMemoryTool } from './maintainMemory';
import { updateMemoryHandler, updateMemoryTool } from './updateMemory';
import { readHandler, readTool } from './read';
import { readRangeHandler, readRangeTool } from './readRange';
import { symbolsPeekHandler, symbolsPeekTool, symbolsSearchHandler, symbolsSearchTool } from './symbols';
import { skillHandler, skillTool } from './skill';
import { taskHandler, taskTool } from './task';
import { todoreadHandler, todoreadTool } from './todoread';
import { todowriteHandler, todowriteTool } from './todowrite';
import {
  googleSearchHandler,
  googleSearchTool,
  visitPageHandler,
  visitPageTool,
  webClickHandler,
  webClickTool,
  webReadHandler,
  webReadTool,
  webScreenshotHandler,
  webScreenshotTool,
  webTypeHandler,
  webTypeTool,
} from './web';
import { writeHandler, writeTool } from './write';

export function registerBuiltinTools(): vscode.Disposable[] {
  backgroundTerminalManager.activate();

  return [
    toolRegistry.registerTool(listTool, listHandler),
    toolRegistry.registerTool(globTool, globHandler),
    toolRegistry.registerTool(lspTool, lspHandler),
    toolRegistry.registerTool(symbolsSearchTool, symbolsSearchHandler),
    toolRegistry.registerTool(symbolsPeekTool, symbolsPeekHandler),
    toolRegistry.registerTool(grepTool, grepHandler),
    toolRegistry.registerTool(getGoalTool, getGoalHandler),
    toolRegistry.registerTool(createGoalTool, createGoalHandler),
    toolRegistry.registerTool(updateGoalTool, updateGoalHandler),
    toolRegistry.registerTool(readTool, readHandler),
    toolRegistry.registerTool(readRangeTool, readRangeHandler),
    toolRegistry.registerTool(writeTool, writeHandler),
    toolRegistry.registerTool(editTool, editHandler),
    toolRegistry.registerTool(bashTool, bashHandler),
    toolRegistry.registerTool(skillTool, skillHandler),
    toolRegistry.registerTool(taskTool, taskHandler),
    toolRegistry.registerTool(todoreadTool, todoreadHandler),
    toolRegistry.registerTool(todowriteTool, todowriteHandler),
    toolRegistry.registerTool(getMemoryTool, getMemoryHandler),
    toolRegistry.registerTool(maintainMemoryTool, maintainMemoryHandler),
    toolRegistry.registerTool(updateMemoryTool, updateMemoryHandler),
    toolRegistry.registerTool(googleSearchTool, googleSearchHandler),
    toolRegistry.registerTool(visitPageTool, visitPageHandler),
    toolRegistry.registerTool(webReadTool, webReadHandler),
    toolRegistry.registerTool(webClickTool, webClickHandler),
    toolRegistry.registerTool(webTypeTool, webTypeHandler),
    toolRegistry.registerTool(webScreenshotTool, webScreenshotHandler),
    backgroundTerminalManager,
  ];
}
