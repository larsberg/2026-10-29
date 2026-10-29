import { CatmullRomCurve3, CylinderGeometry, DataTexture, Group, LatheGeometry, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, RepeatWrapping, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Aged walnut: long, wandering grain, fine pores, narrow board joints and
// uneven polish. All maps are local, deterministic and use no image requests.
function walnutMaps(size=768) {
  const color=new Uint8Array(size*size*4),surface=new Uint8Array(size*size*4);
  const hash=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);};
  const noise=(x,y)=>{
    const ix=Math.floor(x),iy=Math.floor(y);let a=x-ix,b=y-iy;a=a*a*(3-2*a);b=b*b*(3-2*b);
    return (1-b)*((1-a)*hash(ix,iy)+a*hash(ix+1,iy))+b*((1-a)*hash(ix,iy+1)+a*hash(ix+1,iy+1));
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,board=Math.floor(v*6),seam=Math.min((v*6)%1,1-(v*6)%1);
    const flow=v*86+Math.sin(u*7+board)*.6+noise(u*5,v*12)*2.8;
    const grain=Math.sin(flow*6.283)+.35*Math.sin(flow*17.1+noise(u*9,v*42)*3);
    const pore=Math.pow(noise(u*90,v*390),12),patina=noise(u*7,v*8),fine=noise(u*110,v*540);
    const joint=seam<.008?.67:1,shade=(.86+.085*grain+.17*patina+.06*fine-.28*pore+(hash(board,3)-.5)*.15)*joint;
    const i=(y*size+x)*4;
    color[i]=Math.min(255,139*shade);color[i+1]=Math.min(255,83*shade);color[i+2]=Math.min(255,43*shade);color[i+3]=255;
    const rough=Math.round(255*(.48+.12*(1-patina)+.08*pore));
    surface[i]=Math.round(128+grain*9-pore*35);surface[i+1]=rough;surface[i+2]=rough;surface[i+3]=255;
  }
  const make=data=>{const map=new DataTexture(data,size,size);map.wrapS=map.wrapT=RepeatWrapping;map.minFilter=LinearMipmapLinearFilter;map.magFilter=LinearFilter;map.generateMipmaps=true;map.anisotropy=4;map.needsUpdate=true;return map;};
  const map=make(color),detail=make(surface);map.colorSpace=SRGBColorSpace;
  return {map,detail};
}

export function createCafeSetting(envMap) {
  const group=new Group();group.name='French cafe · table for two';
  const geometries=new Set(),materials=new Set(),textures=new Set();
  const maps=walnutMaps();textures.add(maps.map);textures.add(maps.detail);
  function material(value){const m=new MeshPhysicalMaterial(value);materials.add(m);return m;}
  const wood=material({color:'#d8c6b2',map:maps.map,roughnessMap:maps.detail,bumpMap:maps.detail,bumpScale:.012,
    roughness:1,metalness:0,clearcoat:.32,clearcoatRoughness:.3,envMap,envMapIntensity:.65});
  const edge=wood.clone();edge.color.set('#ebc9a2');edge.roughness=.85;materials.add(edge);
  const darkWood=wood.clone();darkWood.color.set('#a28b77');materials.add(darkWood);
  const lengthMap=maps.map.clone(),lengthDetail=maps.detail.clone();
  for(const texture of [lengthMap,lengthDetail]){texture.center.set(.5,.5);texture.rotation=Math.PI/2;texture.needsUpdate=true;textures.add(texture);}
  const lengthMaterials=new Map([wood,edge,darkWood].map(source=>{
    const mat=source.clone();mat.map=lengthMap;mat.bumpMap=mat.roughnessMap=lengthDetail;materials.add(mat);return [source,mat];
  }));
  const brass=material({color:'#94713e',metalness:.8,roughness:.4,envMap,envMapIntensity:.65});
  const porcelain=material({color:'#fffdf7',metalness:0,roughness:.17,clearcoat:1,clearcoatRoughness:.09,ior:1.49,envMap,envMapIntensity:.85});
  function mesh(geometry,mat,parent,name){geometries.add(geometry);const object=new Mesh(geometry,mat);object.name=name;object.castShadow=object.receiveShadow=true;object.layers.enable(1);parent.add(object);return object;}
  function lathe(profile,mat,parent,name,segments=96){return mesh(new LatheGeometry(profile.map(p=>new Vector2(...p)),segments),mat,parent,name);}
  function tube(points,radius,mat,parent,name,segments=48,closed=false){return mesh(new TubeGeometry(new CatmullRomCurve3(points.map(p=>new Vector3(...p)),closed,'centripetal'),segments,radius,12,closed),lengthMaterials.get(mat)??mat,parent,name);}
  function ring(radius,tubeRadius,y,mat,parent,name){const object=mesh(new TorusGeometry(radius,tubeRadius,10,96),mat,parent,name);object.rotation.x=Math.PI/2;object.position.y=y;return object;}
  function planarTop(geometry,radius){const p=geometry.attributes.position,uv=geometry.attributes.uv;
    for(let i=0;i<p.count;i++)if(geometry.attributes.normal.getY(i)>.5)uv.setXY(i,p.getX(i)/(2*radius)+.5,p.getZ(i)/(2*radius)+.5);
    uv.needsUpdate=true;
  }

  const table=new Group();table.name='Round walnut gueridon';group.add(table);
  const top=lathe([[0,2.17],[1.35,2.17],[1.45,2.18],[1.5,2.21],[1.515,2.25],[1.515,2.31],[1.5,2.345],[1.46,2.36],[0,2.36]],wood,table,'Planked walnut tabletop',128);
  planarTop(top.geometry,1.515);
  ring(1.48,.018,2.205,edge,table,'Worn rounded edge');
  const apron=lathe([[1.28,2.01],[1.35,2.01],[1.38,2.04],[1.38,2.17],[1.35,2.2],[1.28,2.2]],darkWood,table,'Solid wood apron');
  apron.material=darkWood;
  lathe([[0,.16],[.28,.16],[.33,.2],[.33,.28],[.27,.33],[.19,.38],[.16,.5],[.18,.68],[.25,.87],[.26,1.02],[.23,1.16],[.16,1.32],[.13,1.52],[.16,1.69],[.25,1.8],[.34,1.86],[.35,1.94],[.29,2.03],[.2,2.14],[0,2.14]],lengthMaterials.get(wood),table,'Turned walnut pedestal');
  ring(.32,.024,.24,brass,table,'Pedestal brass collar');
  for(let i=0;i<3;i++){
    const foot=new Group();foot.rotation.y=i*Math.PI*2/3+.3;table.add(foot);
    tube([[.12,.52,0],[.32,.42,0],[.66,.24,0],[.92,.12,0],[1.05,.09,0]],.095,darkWood,foot,'Swept pedestal foot',32);
    const toe=mesh(new CylinderGeometry(.12,.13,.07,24),brass,foot,'Aged brass foot');toe.position.set(1.02,.045,0);
  }

  // Conventional wooden bistro chairs: a gently shaped rectangular seat,
  // four tapered legs, real seat rails and three bowed horizontal back slats.
  function chair(x,z,yaw,index){
    const chair=new Group();chair.name=`Walnut ladder-back cafe chair ${index}`;chair.position.set(x,0,z);chair.rotation.y=yaw;group.add(chair);
    const woodThickness=.85*.9,seatThickness=.85*2/3,seatBottom=1.274;
    function beam(from,to,width,depth,mat,name,taper=1){
      const start=new Vector3(...from),end=new Vector3(...to),direction=end.clone().sub(start),length=direction.length();
      const geometry=new RoundedBoxGeometry(width*woodThickness,length,depth*woodThickness,3,.022*woodThickness),p=geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const t=(p.getY(i)+length/2)/length,factor=taper+(1-taper)*t;
        p.setX(i,p.getX(i)*factor);p.setZ(i,p.getZ(i)*factor);
      }
      geometry.computeVertexNormals();
      const object=mesh(geometry,lengthMaterials.get(mat)??mat,chair,name);
      object.position.copy(start).add(end).multiplyScalar(.5);object.quaternion.setFromUnitVectors(new Vector3(0,1,0),direction.normalize());return object;
    }
    const seatGeometry=new RoundedBoxGeometry(1.34,.16*seatThickness,1.18,5,.065*seatThickness),p=seatGeometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),z=p.getZ(i),rear=(.59-z)/1.18;
      p.setX(i,x*(1-.13*rear));
      if(p.getY(i)>.015)p.setY(i,p.getY(i)-.035*seatThickness*Math.max(0,1-(x/.65)**2)*Math.max(0,1-(z/.57)**2));
    }
    seatGeometry.computeVertexNormals();planarTop(seatGeometry,.67);
    const seat=mesh(seatGeometry,wood,chair,'Shaped walnut seat');seat.position.y=seatBottom+.08*seatThickness;
    const sideRailY=seatBottom-.17*woodThickness/2+.01,frontRailY=seatBottom-.12*woodThickness/2+.01;
    for(const side of [-1,1]){
      beam([side*.55,.005,.52],[side*.47,1.3,.43],.15,.15,darkWood,'Tapered front leg',.72);
      beam([side*.51,.005,-.5],[side*.43,1.3,-.4],.15,.15,darkWood,'Tapered rear leg',.78);
      beam([side*.43,1.26,-.4],[side*.47,2.68,-.64],.13,.13,wood,'Reclined back post',.94);
      beam([side*.46,sideRailY,-.43],[side*.46,sideRailY,.46],.12,.17,darkWood,'Side seat rail');
      beam([side*.5,.48,-.46],[side*.51,.48,.47],.065,.065,darkWood,'Side leg stretcher');
    }
    beam([-.47,frontRailY,.43],[.47,frontRailY,.43],.12,.17,darkWood,'Front seat rail');
    beam([-.43,frontRailY,-.4],[.43,frontRailY,-.4],.12,.17,darkWood,'Rear seat rail');
    beam([-.5,.46,.47],[.5,.46,.47],.065,.065,darkWood,'Front leg stretcher');
    beam([-.49,.5,-.46],[.49,.5,-.46],.065,.065,darkWood,'Rear leg stretcher');
    for(const [y,height] of [[1.78,.19],[2.15,.2],[2.55,.27]]){
      const geometry=new RoundedBoxGeometry(.98,height*woodThickness,.09*woodThickness,5,.025*woodThickness),p=geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const t=p.getX(i)/.49,bow=Math.max(0,1-t*t);
        p.setZ(i,p.getZ(i)-.11*bow);p.setY(i,p.getY(i)+(y>2.5?.045:.015)*bow);
      }
      geometry.computeVertexNormals();
      const slat=mesh(geometry,wood,chair,y>2.5?'Curved crest rail':'Curved back slat');
      slat.position.set(0,y,-.4-(y-1.26)/1.42*.24);
    }
    return chair;
  }
  const left=chair(-2.05,.22,Math.PI/3,1),right=chair(2.05,-.22,-Math.PI/3,2);

  // A closed lathed porcelain section: recessed well, sloping shoulder, rolled
  // lip, underside and foot ring. The broad glazed rim reads even at a low view.
  const plateProfile=[[0,.032],[.23,.032],[.25,.018],[.28,.018],[.29,.038],[.34,.044],[.43,.075],[.485,.09],[.5,.108],[.498,.126],[.48,.138],[.45,.13],[.39,.104],[.31,.067],[.26,.062],[0,.062]];
  const plates=[];
  for(const side of [-1,1]){
    const plate=lathe(plateProfile,porcelain,table,`White ceramic plate ${side===-1?1:2}`,128);
    plate.position.set(side*.77,2.342,-side*.06);plates.push(plate);
  }
  // Plates are independent props, not children carried by the table transform.
  for(const plate of plates)group.attach(plate);

  // Soft local contact under the furniture supplements the existing spotlight
  // shadows without changing the global AO controls or adding a new light.
  const contactData=new Uint8Array(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const at=(y*64+x)*4,r=Math.hypot((x-31.5)/31.5,(y-31.5)/31.5);contactData[at+3]=Math.round(65*Math.max(0,1-r)**2);}
  const contactMap=new DataTexture(contactData,64,64);contactMap.needsUpdate=true;textures.add(contactMap);
  const contactMaterial=new MeshBasicMaterial({map:contactMap,transparent:true,depthWrite:false,color:0x21140c,polygonOffset:true,polygonOffsetFactor:-1});materials.add(contactMaterial);
  const contactShadows=[];
  for(const [x,z,r,owner] of [[0,0,1.35,table],[-2.05,.22,.85,left],[2.05,-.22,.85,right]]){
    const contact=mesh(new CylinderGeometry(r,r,.001,64),contactMaterial,group,'Soft furniture contact');contact.position.set(x,.006,z);contact.castShadow=contact.receiveShadow=false;contact.layers.disable(1);
    // Cylinder UVs distort the radial map; use the flat top as a planar atlas.
    planarTop(contact.geometry,r);
    contactShadows.push({mesh:contact,owner});
  }
  group.position.z=5.4;
  return {group,table,chairs:[left,right],plates,contactShadows,
    configure(floorY,lighting){group.position.y=floorY;
      for(const mat of materials)if(mat.isMeshPhysicalMaterial){mat.envMapIntensity=(lighting.enabled?lighting.intensity:0)*(mat===porcelain?.85:.65);mat.envMapRotation.y=lighting.rotation*Math.PI/180;}
    },
    dispose(){group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());},
  };
}
