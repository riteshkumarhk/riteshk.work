import { HYBRID_REST_POINTS } from './ai-ribbon-motion.mjs';

const TAU = Math.PI * 2;
const SEGMENTS = 192, SIDES = 12, STRIDE = 7;
const normalize = v => {
  const length = Math.hypot(...v);
  if (length < 1e-9) throw new Error('Degenerate gold ribbon frame');
  return v.map(value => value / length);
};
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const smooth = value => { const t = Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };

export function createGoldMesh() {
  const vertices = new Float32Array((SEGMENTS + 1) * SIDES * STRIDE);
  const indices = new Uint16Array(SEGMENTS * SIDES * 6);
  for (let i = 0, offset = 0; i < SEGMENTS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j, b = a + SIDES;
      const c = i * SIDES + (j + 1) % SIDES, d = c + SIDES;
      indices.set([a,b,c,b,d,c],offset); offset += 6;
    }
  }
  let time = 0;
  return {
    vertices,indices,
    update(state,seconds) {
      time = state.activity === 0 ? 0 : time + Math.max(0,Math.min(.05,seconds)) * state.activity;
      const points = state.points.length ? state.points : HYBRID_REST_POINTS;
      const count = points.length - 1, step = TAU / count;
      const centers = [], lengths = [0];
      for (let i = 0; i <= SEGMENTS; i++) {
        const position = i % SEGMENTS / SEGMENTS * count, index = Math.floor(position), t = position - index;
        const p = points[index], q = points[index + 1];
        const h0 = 2*t*t*t - 3*t*t + 1, h1 = t*t*t - 2*t*t + t;
        const h2 = -2*t*t*t + 3*t*t, h3 = t*t*t - t*t;
        const a = i / SEGMENTS * TAU;
        const center = [
          h0*p.x + h1*step*p.dx + h2*q.x + h3*step*q.dx - 12,
          12 - (h0*p.y + h1*step*p.dy + h2*q.y + h3*step*q.dy),
          2*Math.cos(a) + state.activity*.9*Math.sin(3*a + time*.6)
        ];
        centers.push(center);
        if (i) lengths.push(lengths[i-1] + Math.hypot(...center.map((value,k)=>value-centers[i-1][k])));
      }
      for (let i = 0; i <= SEGMENTS; i++) {
        const before = centers[(i + SEGMENTS - 1) % SEGMENTS], after = centers[(i + 1) % SEGMENTS];
        const tangent = normalize(after.map((value,k)=>value-before[k]));
        const side = normalize([tangent[1],-tangent[0],0]), up = normalize(cross(side,tangent));
        const a = i / SEGMENTS * TAU, u = lengths[i] / lengths[SEGMENTS];
        const twist = .16*Math.cos(a) + state.activity*.42*Math.sin(2*a + time*.45);
        const across = side.map((value,k)=>value*Math.cos(twist)+up[k]*Math.sin(twist));
        const normal = up.map((value,k)=>value*Math.cos(twist)-side[k]*Math.sin(twist));
        const along = ((u + state.trace / 100) % 1 + 1) % 1, span = state.traceLength / 100;
        const tail = along < span ? Math.pow(along/span,1.4) * smooth((span-along)/.025) : 0;
        const taper = 1 - state.traceOpacity + state.traceOpacity*(.25 + .75*Math.sqrt(tail));
        const width = 1.05 * taper, thickness = .34 * taper;
        for (let j = 0; j < SIDES; j++) {
          const b = j / SIDES * TAU, cosine = Math.cos(b), sine = Math.sin(b);
          const n = normalize(across.map((value,k)=>value*cosine/width + normal[k]*sine/thickness));
          const offset = (i*SIDES+j)*STRIDE;
          vertices.set([
            ...centers[i].map((value,k)=>value+across[k]*width*cosine+normal[k]*thickness*sine),
            ...n,u
          ],offset);
        }
      }
      return {vertices,indices,time,activity:state.activity,angle:state.angle,
        thought:state.traceOpacity,travel:-state.trace/100,span:state.traceLength/100};
    }
  };
}

const vertexSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aAlong;
uniform float uTurn;
uniform float uTime;
uniform float uActivity;
uniform float uScale;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vAlong;
vec3 turn(vec3 p) {
  float c=cos(-uTurn), s=sin(-uTurn);
  p=vec3(c*p.x-s*p.y,s*p.x+c*p.y,p.z);
  float tilt=-.24+uActivity*.3*sin(uTime*.37);
  c=cos(tilt); s=sin(tilt);
  p=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
  tilt=.24+uActivity*.22*sin(uTime*.49);
  c=cos(tilt); s=sin(tilt);
  return vec3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);
}
void main() {
  vec3 p=turn(aPosition)*uScale;
  vNormal=turn(aNormal); vPosition=p; vAlong=aAlong;
  float depth=42.-p.z;
  gl_Position=vec4(p.xy*3.2,(81./79.)*depth-160./79.,depth);
}`;

const fragmentSource = `
precision mediump float;
uniform float uThought;
uniform float uTravel;
uniform float uSpan;
uniform float uSmall;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vAlong;
void main() {
  vec3 n=normalize(vNormal);
  vec3 view=normalize(vec3(0.,0.,42.)-vPosition);
  vec3 key=normalize(vec3(-.65,.8,1.));
  vec3 rim=normalize(vec3(.9,-.35,.6));
  float diffuse=max(dot(n,key),0.);
  float spec=pow(max(dot(n,normalize(key+view)),0.),36.);
  float edge=pow(max(dot(n,normalize(rim+view)),0.),52.);
  float reflection=pow(max(dot(reflect(-view,n),normalize(vec3(-.8,.9,1.))),0.),18.);
  vec3 gold=vec3(.64,.32,.075);
  vec3 color=gold*(.2+.48*diffuse+.14*max(dot(n,rim),0.)+.08*uSmall);
  color+=vec3(1.,.87,.63)*(.72*spec+.4*reflection)+vec3(.78,.44,.13)*edge*.65;
  float along=fract(vAlong-uTravel);
  float trail=along<uSpan ? pow(along/uSpan,1.4)*smoothstep(0.,.025,uSpan-along) : 0.;
  float alpha=mix(1.,.045+.955*trail,uThought);
  gl_FragColor=vec4(pow(clamp(color,0.,1.),vec3(1./2.2)),alpha);
}`;

const glassVertexSource = `
attribute vec2 aPosition;
void main() { gl_Position=vec4(aPosition,0.,1.); }
`;

const glassFragmentSource = `
precision highp float;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uSmall;
uniform float uTime;
uniform float uActivity;
float field(vec3 p,float inset) {
  vec3 n=normalize(p);
  float a=5.*n.y+2.2*n.x;
  float b=6.*n.x-3.*n.z+.8;
  float c=8.*n.z+3.*n.y;
  float radius=10.9;
  radius+=.42*mix(sin(a),sin(a+uTime*.48),uActivity);
  radius+=.30*mix(sin(b),sin(b-uTime*.31),uActivity);
  radius+=.16*mix(cos(c),cos(c+uTime*.38),uActivity);
  float thickness=1.05+.10*mix(sin(4.*n.x+3.*n.y),sin(4.*n.x+3.*n.y+uTime*.18),uActivity);
  return length(p)-radius+inset*thickness;
}
vec3 surfaceNormal(vec3 p,float inset) {
  vec2 e=vec2(.025,0.);
  return normalize(vec3(field(p+e.xyy,inset)-field(p-e.xyy,inset),
    field(p+e.yxy,inset)-field(p-e.yxy,inset),
    field(p+e.yyx,inset)-field(p-e.yyx,inset)));
}
bool intersectBody(vec3 origin,vec3 direction,float start,float finish,float inset,out vec3 hit) {
  float distance=start;
  for(int i=0;i<32;i++) {
    hit=origin+direction*distance;
    float gap=field(hit,inset);
    if(gap<.025) return true;
    distance+=max(.015,gap*.65);
    if(distance>finish) break;
  }
  return false;
}
void main() {
  vec2 uv=gl_FragCoord.xy/uResolution;
  vec2 screen=uv*2.-1.;
  vec3 camera=vec3(0.,0.,42.);
  vec3 ray=normalize(vec3(screen/3.2,-1.));
  float b=dot(camera,ray);
  float discriminant=b*b-(42.*42.-12.*12.);
  if(discriminant<=0.) discard;
  vec3 hit;
  if(!intersectBody(camera,ray,-b-sqrt(discriminant),-b+sqrt(discriminant),0.,hit)) discard;
  vec3 normal=surfaceNormal(hit,0.);
  vec3 glassRay=refract(ray,normal,1./1.45);
  vec4 scene=vec4(0.);
  vec3 innerHit;
  if(intersectBody(hit,glassRay,.03,24.,1.,innerHit)) {
    vec3 insideRay=refract(glassRay,surfaceNormal(innerHit,1.),1.45);
    if(insideRay.z<-.001) {
      vec3 centerPlane=innerHit-insideRay*(innerHit.z/insideRay.z);
      vec2 refracted=.5+.5*3.2*centerPlane.xy/42.;
      vec2 sampleUv=mix(uv,refracted,mix(1.,.4,uSmall));
      vec2 blur=vec2(mix(.010,.004,uSmall));
      vec4 sharp=texture2D(uScene,sampleUv);
      vec4 soft=(sharp*2.+texture2D(uScene,sampleUv+blur)+texture2D(uScene,sampleUv-blur)
        +texture2D(uScene,sampleUv+vec2(blur.x,-blur.y))+texture2D(uScene,sampleUv+vec2(-blur.x,blur.y)))/6.;
      scene=mix(sharp,soft,mix(.20,.08,uSmall));
    }
  }
  float incidence=max(dot(-ray,normal),0.);
  vec3 reflected=reflect(ray,normal);
  float key=pow(max(dot(reflected,normalize(vec3(-.6,.8,.6))),0.),14.);
  float rim=pow(max(dot(reflected,normalize(vec3(.85,-.35,.45))),0.),22.);
  float band=exp(-pow((reflected.y-.45)/.08,2.))*smoothstep(-.4,.45,reflected.x);
  float highlight=.95*key+.75*rim+.58*band;
  float edge=pow(1.-incidence,2.2);
  float reflectionAlpha=min(.98,.04+.70*edge+highlight);
  vec3 surface=mix(vec3(.12,.105,.08),vec3(1.,.98,.93),min(1.,.12+edge*.7+highlight*1.3));
  vec3 p=hit/11.;
  float cloud=.5+.22*mix(sin(4.*p.x)*sin(3.*p.y),sin(4.*p.x+uTime*.23)*sin(3.*p.y-uTime*.17),uActivity);
  cloud+=.16*mix(cos(5.*p.z),cos(5.*p.z+uTime*.19),uActivity);
  float diffuse=max(dot(normal,normalize(vec3(-.5,.7,1.))),0.);
  vec3 smoke=mix(vec3(.055,.06,.067),vec3(.24,.235,.22),clamp(.25+.42*diffuse+.25*cloud,0.,1.));
  float coreAlpha=smoothstep(.45,.86,incidence)*mix(.86,.58,uSmall);
  float clarity=mix(.95,.98,uSmall);
  vec3 core=scene.rgb*clarity+smoke*coreAlpha*(1.-scene.a*clarity);
  float alpha=scene.a*clarity+coreAlpha*(1.-scene.a*clarity);
  vec3 color=surface*reflectionAlpha+core*(1.-reflectionAlpha);
  float coverage=smoothstep(0.,mix(.11,.17,uSmall),incidence);
  gl_FragColor=vec4(color,reflectionAlpha+alpha*(1.-reflectionAlpha))*coverage;
}
`;

export function createProgram(gl,vertex,fragment) {
  const shaders = [];
  let program;
  try {
    for (const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not allocate the 3D shader.');
      shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error('3D shader: '+gl.getShaderInfoLog(shader));
    }
    program = gl.createProgram();
    if (!program) throw new Error('Could not allocate the 3D program.');
    shaders.forEach(shader=>gl.attachShader(program,shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('3D program: '+gl.getProgramInfoLog(program));
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach(shader=>gl.deleteShader(shader));
  }
}

export function createGlassPass(gl) {
  let program, buffer, texture, framebuffer, depth, size = 0;
  const dispose = () => {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (depth) gl.deleteRenderbuffer(depth);
  };
  try {
    program = createProgram(gl,glassVertexSource,glassFragmentSource);
    buffer = gl.createBuffer(); texture = gl.createTexture();
    framebuffer = gl.createFramebuffer(); depth = gl.createRenderbuffer();
    if (!buffer || !texture || !framebuffer || !depth) throw new Error('Could not allocate the glass refraction surface.');
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,'aPosition');
    const uniforms = Object.fromEntries(['Scene','Resolution','Small','Time','Activity'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
    return {
      begin(pixels) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        if (size === pixels) return;
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,pixels,pixels,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
        gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,pixels,pixels);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('The glass refraction framebuffer is unavailable.');
        size = pixels;
      },
      upload(source) {
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      },
      draw(small,mesh) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.uniform1i(uniforms.Scene,0); gl.uniform2f(uniforms.Resolution,size,size); gl.uniform1f(uniforms.Small,small?1:0);
        gl.uniform1f(uniforms.Time,mesh.time); gl.uniform1f(uniforms.Activity,mesh.activity);
        gl.drawArrays(gl.TRIANGLES,0,6);
      },
      dispose
    };
  } catch (error) {
    dispose(); throw error;
  }
}

export function createGoldRenderer(canvas,onFailure,enclosed) {
  const gl = canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:true,powerPreference:'low-power'});
  if (!gl) throw new Error('WebGL is unavailable in this browser.');
  const buffers = [];
  let program, glass, disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    buffers.forEach(buffer=>gl.deleteBuffer(buffer));
    glass?.dispose();
    if (program) gl.deleteProgram(program);
    canvas.removeEventListener('webglcontextlost',lost);
  };
  const lost = () => onFailure('The 3D graphics context was lost.');
  try {
    program = createProgram(gl,vertexSource,fragmentSource);
    gl.useProgram(program);
    for (let i = 0; i < 2; i++) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Could not allocate the 3D mesh.');
      buffers.push(buffer);
    }
    const attributes = [['aPosition',3,0],['aNormal',3,12],['aAlong',1,24]].map(([name,size,offset])=>({location:gl.getAttribLocation(program,name),size,offset}));
    const uniforms = Object.fromEntries(['Turn','Time','Activity','Thought','Travel','Span','Small','Scale'].map(name=>[name,gl.getUniformLocation(program,'u'+name)]));
    if (enclosed) glass = createGlassPass(gl);
    let uploaded = false;
    canvas.addEventListener('webglcontextlost',lost);
    return {
      draw(mesh) {
        if (disposed || gl.isContextLost()) return;
        const size = canvas.getBoundingClientRect().width;
        const pixels = Math.round(size * Math.min(2,canvas.ownerDocument.defaultView.devicePixelRatio || 1) * (size <= 32 || enclosed ? 2 : 1.5));
        if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels;
        if (glass) {
          try { glass.begin(pixels); }
          catch (error) { onFailure(error.message); return; }
        }
        gl.viewport(0,0,pixels,pixels);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);
        for (const {location,size,offset} of attributes) {
          gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,STRIDE*4,offset);
        }
        if (!uploaded) gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.DYNAMIC_DRAW);
        else gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.vertices);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers[1]);
        if (!uploaded) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
        uploaded = true;
        for (const [name,value] of Object.entries({Turn:mesh.angle,Time:mesh.time,Activity:mesh.activity,Thought:mesh.thought,Travel:mesh.travel,Span:mesh.span,Small:size<=32?1:0,Scale:enclosed ? .8 : 1})) gl.uniform1f(uniforms[name],value);
        gl.clearColor(0,0,0,0); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        // Resolve the nearest surface first, so fading folds do not double-blend.
        gl.disable(gl.BLEND); gl.depthFunc(gl.LESS); gl.colorMask(false,false,false,false);
        gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);
        gl.colorMask(true,true,true,true); gl.depthMask(false); gl.depthFunc(gl.EQUAL);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.drawElements(gl.TRIANGLES,mesh.indices.length,gl.UNSIGNED_SHORT,0);
        gl.depthMask(true); gl.depthFunc(gl.LESS);
        glass?.draw(size<=32,mesh);
        canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1);
      },
      dispose:release
    };
  } catch (error) {
    release(); throw error;
  }
}
