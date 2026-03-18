const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            if (f !== 'node_modules' && f !== '.git' && f !== 'dist' && f !== 'build' && f !== 'logs' && f !== '.vscode' && !f.startsWith('2026') && f !== 'migrations') {
                walk(dirPath, callback);
            }
        } else {
            callback(path.join(dir, f));
        }
    });
}

function replaceInFile(filePath) {
    const ext = path.extname(filePath);
    if (!['.ts', '.vue', '.html', '.md', '.json', '.sh', '.yml'].includes(ext)) return;
    
    // Ignore some files
    if (filePath.includes('package-lock.json') || filePath.includes('pnpm-lock.yaml')) return;

    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;

    // We replace MindWall -> 有间
    let newContent = content.replace(/MindWall/g, '有间');
    
    // Also mindwall -> youjian for english identifiers if they are not part of docker images?
    // User requested: "项目的名字 变更为 有间，请检查所有的代码全部更改"
    // I will replace MindWall -> 有间 and "心墙" -> "有间"
    newContent = newContent.replace(/心墙/g, '有间');

    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log('Updated:', filePath);
    }
}

['e:/Privy/MindWall/apps', 'e:/Privy/MindWall/docs', 'e:/Privy/MindWall/infra', 'e:/Privy/MindWall/scripts', 'e:/Privy/MindWall/README.md', 'e:/Privy/MindWall/deploy.sh'].forEach(item => {
    if (fs.existsSync(item)) {
        if (fs.statSync(item).isDirectory()) {
            walk(item, replaceInFile);
        } else {
            replaceInFile(item);
        }
    }
});