import {readLimitedBytes} from './security-limits.mjs';
const crcTable = Uint32Array.from({length:256}, (_, i) => {let c=i; for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1; return c>>>0;});
function crc(bytes) {let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export async function validateAndStripPNG(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks=[],compressed=[];let width,height,depth,color,interlace;
  const permitted=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','sRGB','gAMA','cHRM']);
  for(let position=8;position+12<=bytes.length;){
    const length=view.getUint32(position),start=position+8,end=start+length;
    if(end+4>bytes.length)throw new Error('PNG chunk size');
    const kind=String.fromCharCode(...bytes.slice(position+4,start));
    if(crc(bytes.subarray(position+4,end))!==view.getUint32(end))throw new Error('PNG CRC');
    if(position===8){width=view.getUint32(start);height=view.getUint32(start+4);depth=bytes[start+8];color=bytes[start+9];interlace=bytes[start+12];if(bytes[start+10]!==0||bytes[start+11]!==0||interlace>1)throw new Error('PNG encoding');}
    if(kind==='acTL'||kind==='fcTL'||kind==='fdAT')throw new Error('Animated PNG');
    if(!permitted.has(kind)&&/^[A-Z]/.test(kind))throw new Error('PNG critical chunk');
    if(kind==='IDAT')compressed.push(bytes.slice(start,end));
    if(permitted.has(kind))chunks.push(bytes.slice(position,end+4));
    position=end+4;
  }
  const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]},channels={0:1,2:3,3:1,4:2,6:4};
  if(!depths[color]?.includes(depth))throw new Error('PNG bit depth');
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]],rows=[];
  for(const [x,y,dx,dy] of passes){const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));if(w&&h)rows.push([Math.ceil(w*channels[color]*depth/8)+1,h]);}
  const expected=rows.reduce((sum,[length,h])=>sum+length*h,0);
  if(!expected||expected>32000000)throw new Error('PNG decoded size');
  const stream=new Blob(compressed).stream().pipeThrough(new DecompressionStream('deflate'));
  const decoded=await readLimitedBytes(new Response(stream),expected,10000);
  if(decoded.length!==expected)throw new Error('PNG pixel size');
  let position=0;for(const [length,h] of rows)for(let row=0;row<h;row++){if(decoded[position]>4)throw new Error('PNG filter');position+=length;}
  const clean=new Uint8Array(8+chunks.reduce((sum,b)=>sum+b.length,0));clean.set(bytes.subarray(0,8));position=8;for(const chunk of chunks){clean.set(chunk,position);position+=chunk.length;}return clean;
}
