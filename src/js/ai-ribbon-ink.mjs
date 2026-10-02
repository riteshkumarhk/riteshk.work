import { HYBRID_REST_POINTS } from './ai-ribbon-motion.mjs';
import { createProgram } from './ai-ribbon-gold.mjs';

export const TRAIL_SEGMENTS = 24;
const SAMPLES = 384, STRIDE = 8, TAU = Math.PI * 2;

export function paintTrail(paths,d,result,profile) {
  const length = result.traceLength / TRAIL_SEGMENTS;
  paths.forEach((path,index) => {
    path.setAttribute('d',d);
    path.setAttribute('pathLength',100);
    path.setAttribute('stroke-dasharray',`${length + .04} ${100 - length - .04}`);
    path.setAttribute('stroke-dashoffset',result.trace - index * length);
    const tail = profile.floor + (1-profile.floor) * Math.pow((index + 1) / TRAIL_SEGMENTS,profile.power);
    path.setAttribute('opacity',result.traceOpacity * tail);
    if (index === TRAIL_SEGMENTS - 1) {
      path.style.stroke = `color-mix(in srgb, var(--text) ${result.activity * 85}%, var(--accent))`;
      path.style.strokeLinecap = 'round';
    }
  });
}

export function createInkMesh() {
  const vertices = new Float32Array((SAMPLES + 1)*2*STRIDE);
  const indices = new Uint16Array(SAMPLES*6);
  const samples = new Float64Array((SAMPLES + 1)*6);
  for (let i=0;i<SAMPLES;i++) {
    const a=i*2, b=a+2;
    indices.set([a,a+1,b,a+1,b+1,b],i*6);
  }
  return {
    vertices,indices,
    update(state) {
      const points=state.points.length ? state.points : HYBRID_REST_POINTS;
      const count=points.length-1, step=TAU/count;
      let length=0;
      for (let i=0;i<=SAMPLES;i++) {
        const position=i/SAMPLES*count, index=Math.min(count-1,Math.floor(position)), t=position-index;
        const p=points[index], q=points[index+1], t2=t*t, t3=t2*t;
        const x=(2*t3-3*t2+1)*p.x+(t3-2*t2+t)*step*p.dx+(-2*t3+3*t2)*q.x+(t3-t2)*step*q.dx;
        const y=(2*t3-3*t2+1)*p.y+(t3-2*t2+t)*step*p.dy+(-2*t3+3*t2)*q.y+(t3-t2)*step*q.dy;
        const dx=(6*t2-6*t)*p.x+(3*t2-4*t+1)*step*p.dx+(-6*t2+6*t)*q.x+(3*t2-2*t)*step*q.dx;
        const dy=(6*t2-6*t)*p.y+(3*t2-4*t+1)*step*p.dy+(-6*t2+6*t)*q.y+(3*t2-2*t)*step*q.dy;
        const speed=Math.hypot(dx,dy), a=i/SAMPLES*TAU, offset=i*6;
        if (!Number.isFinite(speed) || speed<1e-10) throw new Error('The ink contour has a degenerate tangent.');
        if (i) length+=Math.hypot(x-samples[offset-6],y-samples[offset-5]);
        samples[offset]=x; samples[offset+1]=y;
        samples[offset+2]=-dy/speed; samples[offset+3]=dx/speed;
        samples[offset+4]=.5*Math.sin(a+.4)+.15*Math.sin(2*a+.7); samples[offset+5]=length;
      }
      const crossings=[];
      const smooth=value=>{ const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };
      const distanceAt=(index,t)=>samples[index*SAMPLES/count*6+5]*(1-t)+samples[(index+1)*SAMPLES/count*6+5]*t;
      for (let i=0;i<count;i++) for (let j=i+2;j<count;j++) {
        if (i===0 && j===count-1) continue;
        const p=points[i], q=points[j];
        const ax=points[i+1].x-p.x, ay=points[i+1].y-p.y, bx=points[j+1].x-q.x, by=points[j+1].y-q.y;
        const determinant=ax*by-ay*bx;
        if (Math.abs(determinant)<1e-10) continue;
        const dx=q.x-p.x, dy=q.y-p.y, a=(dx*by-dy*bx)/determinant, b=(dx*ay-dy*ax)/determinant;
        if (a<-1e-8 || a>1+1e-8 || b<-1e-8 || b>1+1e-8) continue;
        const strength=smooth((Math.abs(determinant)/(Math.hypot(ax,ay)*Math.hypot(bx,by))-.12)/.35);
        crossings.push({a:distanceAt(i,Math.max(0,Math.min(1,a))),b:distanceAt(j,Math.max(0,Math.min(1,b))),strength});
      }
      for (let i=0;i<=SAMPLES;i++) {
        const offset=i*6;
        let outline=0;
        // A global halo cuts nearby bends; separate only actual crossings, easing grazing contacts.
        for (const crossing of crossings) {
          const a=Math.abs(samples[offset+5]-crossing.a), b=Math.abs(samples[offset+5]-crossing.b);
          const distance=Math.min(a,length-a,b,length-b);
          outline=Math.max(outline,crossing.strength*smooth((4-distance)/2));
        }
        for (let side=0;side<2;side++) {
          const vertex=(i*2+side)*STRIDE;
          vertices[vertex]=samples[offset]; vertices[vertex+1]=samples[offset+1]; vertices[vertex+2]=samples[offset+4];
          vertices[vertex+3]=samples[offset+2]; vertices[vertex+4]=samples[offset+3];
          vertices[vertex+5]=side ? 1 : -1; vertices[vertex+6]=samples[offset+5]/length;
          vertices[vertex+7]=outline;
        }
      }
      return {vertices,indices,length,angle:state.angle,activity:state.activity,thought:state.traceOpacity,travel:state.trace/100,span:state.traceLength/100};
    }
  };
}

const vertexSource = `#version 300 es
precision highp float;
in vec3 aPosition;
in vec2 aNormal;
in float aSide;
in float aAlong;
in float aOutline;
uniform float uOuter;
uniform float uRadius;
uniform float uTurn;
out float vAcross;
out float vAlong;
out float vOuter;
void main() {
  float outer=mix(uRadius,uOuter,aOutline);
  vec2 p=aPosition.xy+aNormal*aSide*outer-12.;
  float c=cos(uTurn), s=sin(uTurn);
  p=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
  gl_Position=vec4(p.x/12.,-p.y/12.,-aPosition.z*.5,1.);
  vAcross=aSide*outer;
  vAlong=aAlong;
  vOuter=outer;
}`;

const fragmentSource = `#version 300 es
precision highp float;
in float vAcross;
in float vAlong;
in float vOuter;
uniform float uRadius;
uniform float uAa;
uniform float uLength;
uniform float uThought;
uniform float uTravel;
uniform float uSpan;
uniform float uTrack;
uniform float uFloor;
uniform float uPower;
uniform float uActivity;
uniform vec3 uAccent;
uniform vec3 uText;
out vec4 ink;
void main() {
  float coverage=1.-smoothstep(uRadius-uAa,uRadius+uAa,abs(vAcross));
  coverage=mix(coverage,1.,1.-smoothstep(uRadius,uRadius+2.*uAa,vOuter));
  float along=mod(vAlong+uTravel+2.,1.)*uLength;
  float span=uSpan*uLength;
  float inside=1.-step(span,along);
  float fade=mix(uFloor,1.,pow(clamp(along/max(span,.0001),0.,1.),uPower));
  fade*=smoothstep(0.,uRadius*2.,along);
  float ahead=mod(along-span+uLength,uLength);
  float cap=1.-smoothstep(uRadius-uAa,uRadius+uAa,length(vec2(ahead,vAcross)));
  float tail=uThought*max(coverage*fade*inside,cap);
  float head=max(smoothstep(span-span/24.,span,along)*inside,1.-step(uRadius+uAa,ahead));
  float ghost=(uTrack+(1.-uTrack)*(1.-uThought))*coverage;
  vec3 colour=mix(uAccent,uText,.85*uActivity*head);
  float alpha=ghost*(1.-tail)+tail;
  ink=vec4(uAccent*ghost*(1.-tail)+colour*tail,alpha);
}`;

export function createInkRenderer(canvas,profile,colours,onFailure) {
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,depth:true,premultipliedAlpha:true,powerPreference:'low-power'});
  if (!gl) throw new Error('WebGL 2 is unavailable.');
  let program, vertexBuffer, indexBuffer, vertexArray, disposed=false, uploaded=false;
  const lost=event=>{ event.preventDefault(); onFailure('The ink graphics context was lost.'); };
  const dispose=()=>{
    if (disposed) return;
    disposed=true;
    canvas.removeEventListener('webglcontextlost',lost);
    gl.bindVertexArray(null); gl.useProgram(null);
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (indexBuffer) gl.deleteBuffer(indexBuffer);
    if (program) gl.deleteProgram(program);
  };
  try {
    program=createProgram(gl,vertexSource,fragmentSource);
    vertexBuffer=gl.createBuffer(); indexBuffer=gl.createBuffer(); vertexArray=gl.createVertexArray();
    if (!vertexBuffer || !indexBuffer || !vertexArray) throw new Error('Could not allocate the ink surface.');
    const attributes=[['aPosition',3,0],['aNormal',2,12],['aSide',1,20],['aAlong',1,24],['aOutline',1,28]].map(([name,size,offset])=>({location:gl.getAttribLocation(program,name),size,offset}));
    const uniforms=Object.fromEntries(['Outer','Turn','Radius','Aa','Length','Thought','Travel','Span','Track','Floor','Power','Activity','Accent','Text'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
    gl.bindVertexArray(vertexArray); gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
    for (const {location,size,offset} of attributes) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,STRIDE*4,offset);
    }
    canvas.addEventListener('webglcontextlost',lost);
    return {
      draw(mesh,size=canvas.getBoundingClientRect().width,optics=profile) {
        if (disposed) return;
        if (gl.isContextLost()) { onFailure('The ink graphics context was lost.'); return; }
        if (!(size>0)) throw new Error('The ink surface has no visible size.');
        const pixels=Math.ceil(size*Math.min(4,Math.max(3,canvas.ownerDocument.defaultView.devicePixelRatio*2)));
        if (canvas.width!==pixels || canvas.height!==pixels) canvas.width=canvas.height=pixels;
        const aa=24/pixels;
        gl.viewport(0,0,pixels,pixels); gl.useProgram(program); gl.bindVertexArray(vertexArray);
        gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);
        if (!uploaded) gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.DYNAMIC_DRAW);
        else gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.vertices);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
        if (!uploaded) {
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
          const error=gl.getError();
          if (error!==gl.NO_ERROR) throw new Error('Ink surface upload failed: '+error);
        }
        uploaded=true;
        for (const [name,value] of Object.entries({
          Outer:optics.width/2+1,Turn:mesh.angle,Radius:optics.width/2,Aa:aa,Length:mesh.length,
          Thought:mesh.thought,Travel:mesh.travel,Span:mesh.span,Track:optics.track,Floor:optics.floor,Power:optics.power,Activity:mesh.activity
        })) gl.uniform1f(uniforms[name],value);
        gl.uniform3fv(uniforms.Accent,colours.accent); gl.uniform3fv(uniforms.Text,colours.text);
        gl.clearColor(0,0,0,0); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        // One depth-selected, premultiplied surface per pixel; never stack translucent strokes.
        gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
        gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);
        canvas.dataset.frames=String(Number(canvas.dataset.frames || 0)+1);
      },
      dispose
    };
  } catch (error) { dispose(); throw error; }
}
