/**
 * Code Statistics Skill - tool.js
 * 导出一个 analyze 函数，统计项目代码信息
 */

async function analyze(args, context) {
  const targetDir = (args && args.targetDir) || context.projectDir;
  if (!targetDir) {
    throw new Error('未指定分析目录');
  }

  const path = require('path');
  const fs = require('fs');

  // 统计文件类型和行数
  const stats = {
    totalFiles: 0,
    totalLines: 0,
    byExtension: {},
  };

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过常见忽略目录
        if (['node_modules', '.git', 'dist', 'build', 'target'].includes(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        stats.totalFiles++;
        const ext = path.extname(entry.name) || '(no ext)';
        stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          stats.totalLines += content.split('\n').length;
        } catch (err) {
          // 忽略二进制文件
        }
      }
    }
  }

  walk(targetDir);

  const extLines = Object.entries(stats.byExtension)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => ext + ': ' + count + ' files')
    .join('\n');

  return {
    analyzedDir: targetDir,
    totalFiles: stats.totalFiles,
    totalLines: stats.totalLines,
    topExtensions: extLines,
  };
}

module.exports = { analyze };
