import * as fs from 'fs';
import * as path from 'path';
// import * as fsExtra from 'fs-extra';

const sourceDir = 'W:\\EpicGames\\UE_5.1\\Engine\\Source\\Runtime'; // 指定要遍历的目录
const targetDir = 'M:\\UE\\5.1\\UnrealTSDemo\\Plugins\\UnrealTS\\Source\\SlateTS\\Private\\GlueCode'; // 指定新文件存放的目录

// 遍历目录下的所有.h文件
function enumerateHFiles(dir: string): string[] {
    const files = fs.readdirSync(dir);
    let hFiles: string[] = [];
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            hFiles = hFiles.concat(enumerateHFiles(filePath));
        } else if (path.extname(file) === '.h') {
            hFiles.push(filePath);
        }
    }
    return hFiles;
}

function checkContentAndExtractParentClass(file: string) {
    try {
        const content = fs.readFileSync(file, 'utf-8');
        const fileName = path.basename(file, ".h")

        const beginIndex = content.indexOf('SLATE_BEGIN_ARGS');
        const endIndex = content.indexOf('SLATE_END_ARGS');
        if (beginIndex > 0 && endIndex > 0) {
            const slateArgs = content.substring(beginIndex, endIndex)
            const snippet = generateCodeSnippet(slateArgs)

            // 简单的正则表达式尝试匹配类定义的父类部分，例如"class MyClass : public BaseClass"
            // const classRegex = /class\s+([\w_]+_API\s+)?(\w+)\s*:\s*public\s+([\w_]+)(?:\s*,\s*public\s+[\w_]+)*/;
            const classRegex = /class\s+([\w_]+_API\s+)?(\w+)\s*:\s*public\s+([\w_]+)/s;
            // const classRegex = /class\s+([\w_]+_API\s+)?(\w+)\s*:\s*public\s+([\w_]+)(?:\s*,\s*public\s+[\w_]+)*/s;
            const match = content.match(classRegex);// || content.match(/struct\s+(\w+)\s*:\s*public\s+(\w+)/);
            if (match) {
                // 返回匹配到的父类名
                return {isSWidget: true, myClass: match[2], parentClass: match[3], snippet: snippet};
            }
        }
        return {isSWidget: false};
    } catch (err) {
        console.error(`Error reading ${file}: ${err}`);
        return {isSWidget: false};
    }
}

const ignoreFiles = [
    'AndroidWebBrowserWidget',
    'DebugCanvas',
    'MultiBox',
    'MultiBoxCustomization',
    'SDockingArea',
    'SDockingCross',
    'SDockingSplitter',
    'SObjectWidget',
    'SNumericPropertyValue',
    'SStringPropertyValue',
    'SBoolPropertyValue',
    'SEnumPropertyValue',
    'SObjectTableRow',
    'SNumericDropDown',
    'SPropertyViewer',
    'SRotatorInputBox',
    'SSegmentedControl',
    'SFieldIcon',
    'SlateAttribute',
    'SCarouselNavigationBar',
    'SCarouselNavigationButton',
]

// 处理文件并创建新文件
function processFiles() {
    const hFiles = enumerateHFiles(sourceDir);
    const template = getTemplateFile();

    let define_functions: string[] = []
    hFiles.forEach((file) => {
        const classInfo = checkContentAndExtractParentClass(file)
        if (!classInfo.isSWidget) return;

        const baseName = path.basename(file, '.h');
        if (ignoreFiles.includes(baseName)) return;

        const newFileName = `$${baseName}.cpp`;
        const newFilePath = path.join(targetDir, newFileName);

        // 检查目标目录中是否已存在同名文件
        if (fs.existsSync(newFilePath)) {
            console.log(`Skip creating because file already exists: ${newFilePath}`);
        } else {
            let codeFile = template;

            if (classInfo.snippet) {
                codeFile = codeFile.replaceAll("$__ARGUMENTS__$", classInfo.snippet.args)
                codeFile = codeFile.replaceAll("$__DTS_ARGS__$", classInfo.snippet.dts)
                define_functions.push(...classInfo.snippet.def_funcs)
            }

            codeFile = codeFile.replaceAll("$WidgetClass$", classInfo.myClass);
            codeFile = codeFile.replaceAll("$SuperClass$", classInfo.parentClass);
            // 创建一个空的.cpp文件
            fs.writeFileSync(newFilePath, codeFile);
            console.log(`Created file: ${newFilePath}`);
        }
    });

    //移除所有为undefined元素
    define_functions = define_functions.filter(item => item !== undefined);
    define_functions = define_functions.filter((item, index, array) => array.indexOf(item) === index);
    define_functions.sort()
    let func_temp = "";
    let func_json = {};
    let func_json_name = "";
    define_functions.forEach((func) => {
        const index = func.indexOf("(")
        const func_name = func.substring(0, index)
        if (func_name != func_temp) {
            func_json_name = func_name;
            func_json[func_json_name] = []
        }
        func_json[func_json_name].push(func)

        func_temp = func_name
    })

    fs.writeFileSync(path.join(targetDir, "DEFINE_FUNCTION.json"), JSON.stringify(func_json, null, 4))
}

function generateCodeSnippet(inputText) {
    const slateArgs = inputText.match(/SLATE_\w+\([^)]*\)/g) || [];

    const output1 = slateArgs.map(arg => {
        const match = arg.match(/SLATE_(\w+)\(([^,]+),\s*([^)]+)\)/);
        if (match) {
            const [, type, argType, name] = match;
            return `\t\t$SLATE_${type.trim()}(${argType.trim()}, ${name.trim()}, );`;
        }
        return '';
    }).filter(line => line !== '').join('\n');

    const output2 = slateArgs.map(arg => {
        const match = arg.match(/SLATE_(\w+)\(([^,]+),\s*([^)]+)\)/);
        if (match) {
            const [, type, valueType, name] = match;
            return `\t\tArgs.Add<${valueType.trim()}>("${name.trim()}", DTS::EArgType::SLATE_${type.trim()});`;
        }
        return '';
    }).filter(line => line !== '').join('\n');


    const output3 = slateArgs.map(arg => {
        const match = arg.match(/SLATE_(\w+)\(([^,]+),\s*([^)]+)\)/);
        if (match) {
            const [, type, argType, name] = match;
            return `DEFINE_FUNCTION_SLATE_${type.trim()}(${argType.trim()}, ${name.trim()}, );`;
        }
    })

    return {args: output1, dts: output2, def_funcs: output3}
}

//$SET_ARGUMENTS$
//$SET_DTS_ARGS$

// 确保目标目录存在
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir);
}

function getTemplateFile() {
    const file = "M:\\UE\\5.1\\UnrealTSDemo\\Plugins\\UnrealTS\\Source\\SlateTS\\Private\\Template\\Template.txt"
    return fs.readFileSync(file, 'utf-8');
}

processFiles();