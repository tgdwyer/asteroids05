import { fromEvent,interval } from 'rxjs'; 
import { map,filter,merge,scan } from 'rxjs/operators';

const 
  Constants = {
    BulletExpirationTime: 1000,
    CanvasSize: 600,
    BulletRadius: 3,
    StartRockRadius: 30,
    StartRocksCount: 5,
    RotationAcc: 0.1,
    ThrustAcc: 0.1,
    StartTime: 0
  },
  torusWrap = ({x,y}:Vec) => { 
    const s=Constants.CanvasSize, 
      wrap = (v:number) => v < 0 ? v + s : v > s ? v - s : v;
    return new Vec(wrap(x),wrap(y))
  };
  
type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'Space'
type Event = 'keydown' | 'keyup'
// our game has the following view element types:
type ViewType = 'ship' | 'rock' | 'bullet';

function asteroids() {
  class Tick { constructor(public readonly elapsed:number) {} }
  class Rotate { constructor(public readonly direction:number) {} }
  class Thrust { constructor(public readonly on:boolean) {} }
  class Shoot { constructor() {} }
  
  const keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
    fromEvent<KeyboardEvent>(document,e)
        .pipe(
          filter(({code})=>code === k),
          filter(({repeat})=>!repeat),
          map(result)),
    startLeftRotate = keyObservable('keydown','ArrowLeft',()=>new Rotate(-.1)),
    startRightRotate = keyObservable('keydown','ArrowRight',()=>new Rotate(.1)),
    stopLeftRotate = keyObservable('keyup','ArrowLeft',()=>new Rotate(0)),
    stopRightRotate = keyObservable('keyup','ArrowRight',()=>new Rotate(0)),
    startThrust = keyObservable('keydown','ArrowUp', ()=>new Thrust(true)),
    stopThrust = keyObservable('keyup','ArrowUp', ()=>new Thrust(false)),
    shoot = keyObservable('keydown','Space', ()=>new Shoot())

  interface Body {
    readonly id:string,
    readonly viewType: ViewType,
    readonly pos:Vec, 
    readonly vel:Vec,
    readonly acc:Vec,
    readonly angle:number,
    readonly rotation:number,
    readonly torque:number,
    readonly radius:number,
    readonly createTime:number
  }
  interface State {
    readonly time:number,
    readonly ship:Body,
    readonly bullets:ReadonlyArray<Body>,
    readonly rocks:ReadonlyArray<Body>,
    readonly exit:ReadonlyArray<Body>,
    readonly objCount:number,
    readonly gameOver:boolean
  }
  // Rocks and bullets are both just circles
  const createCircle = (viewType: ViewType)=> (oid:number)=> (time:number)=> (radius:number)=> (pos:Vec)=> (vel:Vec)=>
    <Body>{
      createTime: time,
      pos:pos,
      vel:vel,
      acc:Vec.Zero,
      angle:0,
      rotation:0,
      torque:0,
      radius: radius,
      id: viewType+oid,
      viewType: viewType
    };
  function createShip():Body {
    return {
      id: 'ship',
      viewType: 'ship',
      pos: new Vec(Constants.CanvasSize/2,Constants.CanvasSize/2),
      vel: Vec.Zero,
      acc: Vec.Zero,
      angle:0,
      rotation:0,
      torque:0,
      radius:20,
      createTime:0
    }
  }
  const
    // We start with several rocks already
    startRocks = [...Array(Constants.StartRocksCount)]
      .map((_,i)=>createCircle("rock")(i)
         (Constants.StartTime)(Constants.StartRockRadius)(Vec.Zero)
         (new Vec(0.5 - Math.random(), 0.5 - Math.random())));
  const initialState:State = {
    time:0,
    ship: createShip(),
    bullets: [],
    rocks: startRocks,
    exit: [],
    objCount: Constants.StartRocksCount,
    gameOver: false
  }
  const moveObj = (o:Body) => <Body>{
    ...o,
    rotation: o.rotation + o.torque,
    angle:o.angle+o.rotation,
    pos:torusWrap(o.pos.add(o.vel)),
    vel:o.vel.add(o.acc)
  },
  
  handleCollisions = (s:State) => {
    const
      bodiesCollided = (a:Body,b:Body) => a.pos.sub(b.pos).len() < a.radius + b.radius,
      elem = (a:Body[]) => (e:Body) => a.findIndex(b=>b.id === e.id) >= 0,
      shipCollided = s.rocks.filter(r=>bodiesCollided(s.ship,r)).length > 0,
      allBulletsAndRocks = flatMap(s.bullets,b=>s.rocks.map(r=>({bullet:b,rock:r}))),
      collidedBulletsAndRocks = allBulletsAndRocks.filter(({bullet:b,rock:r})=>bodiesCollided(b,r)),
      collidedBullets = collidedBulletsAndRocks.map(({bullet})=>bullet),
      collidedRocks = collidedBulletsAndRocks.map(({rock})=>rock),
      createChildRock = (r:Body,dir:number)=>
        createCircle('rock')(0/*we assign the ids later*/)
                  (s.time)(r.radius/2)
                  (r.pos)(r.vel.ortho().scale(dir)),
      spawnChildRocks = (r:Body)=>
                            r.radius >= Constants.StartRockRadius/4 
                            ? [createChildRock(r,1),createChildRock(r,-1)] : [],
      newRocks = flatMap(collidedRocks, spawnChildRocks)
        .map((r,i)=><Body>{...r, id: r.viewType + (s.objCount + i)})
    return <State>{
      ...s,
      bullets: s.bullets.filter(not(elem(collidedBullets))),
      rocks: s.rocks.filter(not(elem(collidedRocks))).concat(newRocks),
      exit: s.exit.concat(collidedBullets,collidedRocks),
      objCount: s.objCount + newRocks.length,
      gameOver: shipCollided
    }
  };
  
  const tick = (s:State,elapsed:number) => {
    const 
      expired = (b:Body)=>(elapsed - b.createTime) > 100,
      expiredBullets:Body[] = s.bullets.filter(expired),
      activeBullets = s.bullets.filter(not(expired));
    return handleCollisions({...s, 
      ship:moveObj(s.ship), 
      bullets:activeBullets.map(moveObj), 
      rocks: s.rocks.map(moveObj),
      exit:expiredBullets,
      time:elapsed
    })
  }
  const reduceState = (s:State, e:Rotate|Thrust|Tick|Shoot)=>
    e instanceof Rotate ? {...s,
      ship: {...s.ship,torque:e.direction}
    } :
    e instanceof Thrust ? {...s,
      ship: {...s.ship, acc:e.on?Vec.unitVecInDirection(s.ship.angle).scale(Constants.ThrustAcc):Vec.Zero}
    } :
    e instanceof Shoot ? {...s,
      bullets: s.bullets.concat([
            createCircle('bullet')(s.objCount)(s.time)
                      (Constants.BulletRadius)(s.ship.pos)
                      (s.ship.vel.add(Vec.unitVecInDirection(s.ship.angle).scale(2)))]),
      objCount: s.objCount + 1
    } : 
    tick(s,e.elapsed);
  const subscription = interval(10).pipe(
    map(elapsed=>new Tick(elapsed)),
    merge(
      startLeftRotate,startRightRotate,stopLeftRotate,stopRightRotate),
    merge(startThrust,stopThrust),
    merge(shoot),
    scan(reduceState, initialState)
    ).subscribe(updateView);
  function updateView(s: State) {
    const 
      svg = document.getElementById("svgCanvas")!,
      ship = document.getElementById("ship")!,
      show = (id:string,condition:boolean)=>((e:HTMLElement) => 
        condition ? e.classList.remove('hidden')
                  : e.classList.add('hidden'))(document.getElementById(id)!),

      attr = (e:Element,o:any) =>
        { for(const k in o) e.setAttribute(k,String(o[k])) }
    attr(ship,{transform:`translate(${s.ship.pos.x},${s.ship.pos.y}) rotate(${s.ship.angle})`});
    show("leftThrust",  s.ship.torque<0);
    show("rightThrust", s.ship.torque>0);
    show("thruster",    s.ship.acc.len()>0);
    
    const updateBodyView = (b:Body) => {
      const createBodyView = ()=>{
        const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
        attr(v,{id:b.id,rx:b.radius,ry:b.radius});
        v.classList.add(b.viewType)
        svg.appendChild(v)
        return v;
      }
      let v = document.getElementById(b.id) || createBodyView();
      attr(v,{cx:b.pos.x,cy:b.pos.y});
    };
    s.bullets.forEach(updateBodyView);
    s.rocks.forEach(updateBodyView);
    s.exit.forEach(o=>{
      const v = document.getElementById(o.id);
      if(v) svg.removeChild(v)
    })
    if(s.gameOver) {
      subscription.unsubscribe();
      const v = document.createElementNS(svg.namespaceURI, "text")!;
      attr(v,{x:Constants.CanvasSize/6,y:Constants.CanvasSize/2});
      v.textContent = "Game Over";
      v.classList.add('gameover')
      svg.appendChild(v);
    }
  }
} 

//window.onload = asteroids;
setTimeout(asteroids,0)

function showKeys() {
  function showKey(k:Key) {
    const arrowKey = document.getElementById(k)!,
      o = (e:Event) => fromEvent<KeyboardEvent>(document,e).pipe(
        filter(({code})=>code === k))
    o('keydown').subscribe(e => arrowKey.classList.add("highlight"))
    o('keyup').subscribe(_=>arrowKey.classList.remove("highlight"))
  }
  showKey('ArrowLeft');
  showKey('ArrowRight');
  showKey('ArrowUp');
  showKey('Space');
}

setTimeout(showKeys, 0);

class Vec {
  constructor(public readonly x: number = 0, public readonly y: number = 0) {}
  add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
  sub = (b:Vec) => this.add(b.scale(-1))
  len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
  scale = (s:number) => new Vec(this.x*s,this.y*s)
  ortho = ()=> new Vec(this.y,-this.x)
  rotate = (deg:number) =>
            (rad =>(
                (cos,sin,{x,y})=>new Vec(x*cos - y*sin, x*sin + y*cos)
              )(Math.cos(rad), Math.sin(rad), this)
            )(Math.PI * deg / 180)

  static unitVecInDirection = (
    deg: number) => new Vec(0,-1).rotate(deg)
  static Zero = new Vec();
}

/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T,U>(a:ReadonlyArray<T>,f:(a:T)=>U[]):U[] {
  return Array.prototype.concat(...a.map(f));
}

const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x);