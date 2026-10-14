// Verify the installed Serena launcher against disposable copies of our fixtures.
// No model inference, real-project edits, hardware access, or memory writes.
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, cp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const python = process.env.SERENA_PYTHON ?? `${process.env.HOME}/.local/share/uv/tools/serena-agent/bin/python`;
const launcher = resolve('tools/serena_launcher.py');
const cases = [
 ['swift','SamplePackage','Sources/Sample/Engine.swift','updateLocation'],
 ['rust','SampleRust','src/lib.rs','scale'],
 ['cpp','SampleC','engine.c','scale'],
 ['typescript','SampleTypeScript','engine.ts','scale'],
 ['python','SamplePython','engine.py','scale'],
 ['wat','SampleWasm','engine.wat','scale'],
];
const root = await realpath(await mkdtemp(join(tmpdir(),'serena-verification-')));
try {
 for (const [language, fixture, file, name] of cases) {
  const project=join(root,fixture);
  await cp(resolve('fixtures',fixture),project,{recursive:true,filter:p=>!p.includes('/.build')&&!p.includes('/target')});
  await mkdir(join(project,'.serena'));
  await writeFile(join(project,'.serena/project.yml'),`project_name: verify-${language}\nlanguage_servers: [${language}]\n`);
  if(language==='cpp') await writeFile(join(project,'compile_commands.json'),JSON.stringify(['engine.c','render.c','test_engine.c'].map(f=>({directory:project,file:join(project,f),arguments:['cc','-std=c99',`-I${project}`,'-c',join(project,f)]}))));
  if(language==='swift') execFileSync('/usr/bin/swift',['build','--build-tests'],{cwd:project,stdio:'pipe',timeout:90000});
  for (const context of language==='typescript'?['codex','claude-code']:['codex']) {
   const client=new Client({name:'serena-verification',version:'1'});
   const transport=new StdioClientTransport({command:python,args:[launcher,'start-mcp-server','--context',context,'--project',project,'--add-mode','no-memories','--add-mode','no-onboarding'],env:{PATH:`${process.env.HOME}/.local/bin:${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin`},stderr:'pipe'});
   try {
    await client.connect(transport);
    const call=async(tool,args)=>{const r=await client.callTool({name:tool,arguments:args},undefined,{timeout:180000});const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');if(r.isError||/Error executing tool|Error:|Exception:/.test(text))throw Error(`${language}: ${tool}: ${text.slice(0,1000)}`);return text};
    await call('initial_instructions',{});
    await call('get_diagnostics_for_file',{relative_path:file});
    const text=await call('find_symbol',{name_path_pattern:name,relative_path:file,substring_matching:true,include_body:true});
    let found;try{found=JSON.parse(text)}catch{throw Error(`Unexpected symbol response: ${text.slice(0,1000)}`)}
    if(!Array.isArray(found)||!found.length||!found[0].body)throw Error(`Missing ${language} symbol body: ${text.slice(0,600)}`);
    let references=await call('find_referencing_symbols',{name_path:found[0].name_path,relative_path:file});
    if(language==='swift' && references==='{}') {await new Promise(r=>setTimeout(r,3000));references=await call('find_referencing_symbols',{name_path:found[0].name_path,relative_path:file});}
    if(!references.includes(language==='swift'?'Recorder/record':'render'))throw Error(`Missing ${language} reference: ${references.slice(0,600)}`);
    if(language==='typescript'&&context==='codex') {
      await call('rename_symbol',{name_path:found[0].name_path,relative_path:file,new_name:'scaleVerified'});
      if(!(await readFile(join(project,'render.ts'),'utf8')).includes('scaleVerified'))throw Error('Cross-file rename failed');
      await call('rename_symbol',{name_path:'scaleVerified',relative_path:file,new_name:'scale'});
    }
    console.log(`${context}/${language}: diagnostics, symbol body and references verified${language==='typescript'&&context==='codex'?'; cross-file rename verified':''}`);
   } finally {await client.close()}
  }
 }
} finally {await rm(root,{recursive:true,force:true})}
