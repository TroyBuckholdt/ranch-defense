// One shared glTF loader setup. The 3D models are Draco-compressed (about 5x smaller
// downloads, which matters most on phones); the small decoder runs in web workers.
// On Low graphics every model loads its phone version (*.lo.glb: half-size textures,
// lighter meshes), which also keeps phones well inside their graphics memory.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const draco = new DRACOLoader();
draco.setDecoderPath('/assets/draco/');
draco.preload();

let lowDetail = false;
export function setLowDetail(on) { lowDetail = !!on; }
export const isLowDetail = () => lowDetail;
// texture / sky files: phones get the half-size copies in tex/lo/
export const texURL = (file) => `/assets/tex/${lowDetail ? 'lo/' : ''}${file}`;

export function gltfLoader() {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const load = loader.load.bind(loader);
  loader.load = (url, ...rest) => load(lowDetail && /[^/]\.glb$/.test(url) && !/(_walk|_run|\.lo)\.glb$/.test(url) ? url.replace(/\.glb$/, '.lo.glb') : url, ...rest);
  return loader;
}
