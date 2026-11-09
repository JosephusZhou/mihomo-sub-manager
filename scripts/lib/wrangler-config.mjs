#!/usr/bin/env node
// 极简 wrangler TOML 读写工具：只处理本项目用到的字符串/数字键，避免为脚本引入 TOML 依赖。
// 用法：
//   node wrangler-config.mjs get <file> <section> <key>
//   node wrangler-config.mjs set <file> <section> <key> <value>
//   node wrangler-config.mjs set-routes <file> <domain>   # domain 为空表示移除 routes
// section 取值：''（顶层）、d1、kv、vars

import fs from 'node:fs';

const [, , command, file, section = '', key, value] = process.argv;

const SECTION_HEADERS = {
  d1: '[[d1_databases]]',
  kv: '[[kv_namespaces]]',
  vars: '[vars]',
};

function headerFor(section) {
  if (!section) return '';
  const header = SECTION_HEADERS[section];
  if (!header) throw new Error(`不支持的分段：${section}`);
  return header;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quote(text) {
  return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readLines() {
  return fs.readFileSync(file, 'utf8').split('\n');
}

function writeLines(lines) {
  fs.writeFileSync(file, lines.join('\n'));
}

// 返回 [start, end)；start 为分段头所在行，end 为下一个分段头之前。
function sectionBounds(lines, section) {
  const header = headerFor(section);
  if (!header) {
    const end = lines.findIndex((line) => /^\s*\[/.test(line));
    return [0, end === -1 ? lines.length : end];
  }
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

function getValue() {
  const lines = readLines();
  const bounds = sectionBounds(lines, section);
  if (!bounds) return '';
  const [start, end] = bounds;
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  for (let i = start; i < end; i += 1) {
    const match = lines[i].match(matcher);
    if (!match) continue;
    const raw = match[1].trim();
    const doubleQuoted = raw.match(/^"((?:[^"\\]|\\.)*)"/);
    if (doubleQuoted) {
      return doubleQuoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    const singleQuoted = raw.match(/^'([^']*)'/);
    if (singleQuoted) return singleQuoted[1];
    return raw.replace(/\s+#.*$/, '').trim();
  }
  return '';
}

function setValue() {
  const lines = readLines();
  const header = headerFor(section);
  const isTopLevel = !header;
  let bounds = sectionBounds(lines, section);

  if (!bounds) {
    if (!header) throw new Error(`顶层缺少配置项：${key}`);
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(header, `${key} = ${quote(value)}`);
    writeLines(lines);
    return;
  }

  const [start, end] = bounds;
  const scanFrom = isTopLevel ? start : start + 1;
  const matcher = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=`);
  for (let i = scanFrom; i < end; i += 1) {
    if (matcher.test(lines[i])) {
      const indent = lines[i].match(matcher)[1];
      lines[i] = `${indent}${key} = ${quote(value)}`;
      writeLines(lines);
      return;
    }
  }

  let insertAt = scanFrom;
  for (let i = scanFrom; i < end; i += 1) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  lines.splice(insertAt, 0, `${key} = ${quote(value)}`);
  writeLines(lines);
}

if (!file) {
  console.error('缺少配置文件路径');
  process.exit(2);
}

// 移除已有的 routes（单行或多行数组）以及 [[routes]] 分段，保证 set-routes 幂等。
function removeRoutes(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\[\[routes\]\]\s*$/.test(lines[i])) {
      i += 1;
      while (i < lines.length && !/^\s*\[/.test(lines[i])) i += 1;
      continue;
    }

    if (/^\s*routes\s*=/.test(lines[i])) {
      let depth = 0;
      let foundArray = false;
      let j = i;
      for (; j < lines.length; j += 1) {
        for (const char of lines[j]) {
          if (char === '[') {
            depth += 1;
            foundArray = true;
          } else if (char === ']') {
            depth -= 1;
          }
        }
        if (foundArray && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    out.push(lines[i]);
    i += 1;
  }
  return out;
}

function setRoutes(domain) {
  let lines = removeRoutes(readLines());

  // 折叠连续空行，避免多次 set-routes 后空行累积。
  lines = lines.filter((line, index) => {
    if (line.trim() !== '') return true;
    return index === 0 || (lines[index - 1] && lines[index - 1].trim() !== '');
  });
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

  if (domain) {
    let end = lines.findIndex((line) => /^\s*\[/.test(line));
    if (end === -1) end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') {
      lines.splice(end - 1, 1);
      end -= 1;
    }
    lines.splice(end, 0, 'routes = [', `  { pattern = ${quote(domain)}, custom_domain = true }`, ']', '');
  }

  writeLines([...lines, '']);
}

if (command === 'get') {
  process.stdout.write(getValue());
} else if (command === 'set') {
  if (value === undefined) {
    console.error('set 需要提供 value');
    process.exit(2);
  }
  setValue();
} else if (command === 'set-routes') {
  setRoutes(section || '');
} else {
  console.error(`未知命令：${command}`);
  process.exit(2);
}
