import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import {applyTheme} from '../../src/themes.ts';
import '../../src/nodes/FileViewerNode.tsx';
import {getNodeType} from '../../src/node-registry.ts';
import {ImageNodeRenderer,createImageNodeDefaultData} from '../../src/nodes/ImageNode.tsx';
import {GateStrip} from '../../src/nodes/leader/GateStrip.tsx';
import {ConfirmModal} from '../../src/components/ConfirmModal.tsx';
import {LineageModal} from '../../src/LineageModal.tsx';
import '../../src/lineage.css';
const search=new URLSearchParams(location.search);applyTheme((search.get('theme')??'Midnight').toLowerCase());
const long='unbrokenvalue'.repeat(24);
const canvas=document.createElement('canvas');canvas.width=520;canvas.height=320;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#edf2fc';ctx.fillRect(0,0,520,320);ctx.fillStyle='#18213b';ctx.font='28px sans-serif';ctx.fillText('Isolated image specimen',30,80);
const lin:any={id:'nested-review',projectId:'fixture',repositoryPath:'/fixture',targetRef:'main',baseSha:'b'.repeat(40),integrationHeadSha:'c'.repeat(40),integrationRef:'combined',integrationWorktreePath:'/fixture/integration',revision:1,integrationState:'active',status:'open',memberships:[],resolutionRuns:[],contributions:[],queue:[],gates:[],reviews:[],createdAt:1,updatedAt:1};
function App(){const [file,setFile]=useState({filePath:'src/long-file-name-'+long+'.ts',collapsed:false});const [image,setImage]=useState({...createImageNodeDefaultData(),src:canvas.toDataURL(),naturalWidth:520,naturalHeight:320,filename:'review-'+long+'.png',annotations:[{id:'pin-1',kind:'pin',x:.4,y:.5,color:'#3b82f6',order:1,note:'Review '+long}],selectedAnnotationId:'pin-1'});const [confirm,setConfirm]=useState(false);const [lineage,setLineage]=useState(false);
const File=getNodeType('file-viewer')!.render;const props:any={node:{id:'file',type:'file-viewer',position:{x:0,y:0},size:{width:480,height:330},data:file},projectPath:'/fixture',onUpdateData:setFile,isSelected:true};
return <main style={{padding:12,maxWidth:960,margin:'auto',color:'var(--text-primary)'}}><p>SIMULATED local mounted production components — no WS, source or project mutations.</p><section aria-label="File specimen" style={{height:330,border:'1px solid var(--border-default)'}}><File {...props}/></section><section aria-label="Image specimen" style={{height:360,marginTop:12}}><ImageNodeRenderer {...props} node={{...props.node,id:'image',type:'image',data:image}} onUpdateData={setImage}/></section><section aria-label="Governance specimen"><GateStrip gates={{allowed:false,mode:'enforced',gates:[{id:'review',name:'Independent craft review',status:'failed',reason:'Failed verification: '+long}]}} sessionKey={null}/></section><button onClick={()=>setConfirm(true)}>Open isolated confirmation</button><button onClick={()=>setLineage(true)}>Open nested lineage</button>{lineage&&<LineageModal lineage={lin} workItemId="fixture" allLineages={[lin]} send={()=>{}} onClose={()=>setLineage(false)}/>} {confirm&&<ConfirmModal title="Inspect long-value confirmation" description={<>Preserved evidence path /fixture/{long}. No destructive action will run.</>} actions={[{label:'Simulation only',onClick:()=>{}}]} onClose={()=>setConfirm(false)}/>}</main>}
createRoot(document.getElementById('root')!).render(<App/>);
// A bounded nested-modal fixture, not an app action producer.
(window as any).openNestedConfirm=()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Open isolated confirmation');b?.click()};
