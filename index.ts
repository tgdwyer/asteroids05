/**
# Introduction
[See full documentation](https://tgdwyer.github.io/asteroids/)

Observables allow us to capture asynchronous actions like user interface events in streams.  These allow us to "linearise" the flow of control, avoid deeply nested loops, and process the stream with pure, referentially transparent functions.

As an example we will build a little "Asteroids" game using Observables.  We're going to use [rxjs](https://rxjs-dev.firebaseapp.com/) as our Observable implementation, and we are going to render it in HTML using SVG.
We're also going to take some pains to make pure functional code (and lots of beautiful curried lambda (arrow) functions). We'll use [typescript type annotations](https://www.typescriptlang.org/) to help us ensure that our data is indeed immutable and to guide us in plugging everything together without type errors.
 */
import { fromEvent, interval, merge } from 'rxjs'; 
import { map, filter, scan } from 'rxjs/operators';

type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'Space'
type Event = 'keydown' | 'keyup'

function asteroids() {
  const 
    Constants = {
      CanvasSize: 600,
      BulletExpirationTime: 1000,
      BulletRadius: 3,
      BulletVelocity: 2,
      StartRockRadius: 30,
      StartRocksCount: 5,
      RotationAcc: 0.1,
      ThrustAcc: 0.1,
      StartTime: 0
    } as const

  // our game has the following view element types:
  type ViewType = 'ship' | 'rock' | 'bullet'

  // Four types of game state transitions
  class Tick { constructor(public readonly elapsed:number) {} }
  class Rotate { constructor(public readonly direction:number) {} }
  class Thrust { constructor(public readonly on:boolean) {} }
  class Shoot { constructor() {} }
  
  const 
    gameClock = interval(10)
      .pipe(map(elapsed=>new Tick(elapsed))),

    keyObservable = <T>(e:Event, k:Key, result:()=>T)=>
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

  // Every object that participates in physics is a Body
  type Body = Readonly<{
    id:string,
    viewType: ViewType,
    pos:Vec, 
    vel:Vec,
    acc:Vec,
    angle:number,
    rotation:number,
    torque:number,
    radius:number,
    createTime:number
  }>

  // Game state
  type State = Readonly<{
    time:number,
    ship:Body,
    bullets:ReadonlyArray<Body>,
    rocks:ReadonlyArray<Body>,
    exit:ReadonlyArray<Body>,
    objCount:number,
    gameOver:boolean
  }>

  // Rocks and bullets are both just circles
  const createCircle = (viewType: ViewType)=> (oid:number)=> (time:number)=> (radius:number)=> (pos:Vec)=> (vel:Vec)=>
    <Body>{
      createTime: time,
      pos:pos,
      vel:vel,
      acc:Vec.Zero,
      angle:0, rotation:0, torque:0,
      radius: radius,
      id: viewType+oid,
      viewType: viewType
    }

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
    startRocks = [...Array(Constants.StartRocksCount)]
      .map((_,i)=>createCircle("rock")(i)
         (Constants.StartTime)(Constants.StartRockRadius)(Vec.Zero)
         (new Vec(0.5 - Math.random(), 0.5 - Math.random()))),

    initialState:State = {
      time:0,
      ship: createShip(),
      bullets: [],
      rocks: startRocks,
      exit: [],
      objCount: Constants.StartRocksCount,
      gameOver: false
    },

    // wrap a positions around edges of the screen
    torusWrap = ({x,y}:Vec) => { 
      const s=Constants.CanvasSize, 
        wrap = (v:number) => v < 0 ? v + s : v > s ? v - s : v;
      return new Vec(wrap(x),wrap(y))
    },

    // all movement comes through here
    moveBody = (o:Body) => <Body>{
      ...o,
      rotation: o.rotation + o.torque,
      angle:o.angle+o.rotation,
      pos:torusWrap(o.pos.add(o.vel)),
      vel:o.vel.add(o.acc)
    },
    
    // check a State for collisions:
    //   bullets destroy rocks spawning smaller ones
    //   ship colliding with rock ends game
    handleCollisions = (s:State) => {
      const
        bodiesCollided = ([a,b]:[Body,Body]) => a.pos.sub(b.pos).len() < a.radius + b.radius,
        shipCollided = s.rocks.filter(r=>bodiesCollided([s.ship,r])).length > 0,
        allBulletsAndRocks = flatMap(s.bullets, b=> s.rocks.map(r=>([b,r]))),
        collidedBulletsAndRocks = allBulletsAndRocks.filter(bodiesCollided),
        collidedBullets = collidedBulletsAndRocks.map(([bullet,_])=>bullet),
        collidedRocks = collidedBulletsAndRocks.map(([_,rock])=>rock),

        // spawn two children for each collided rock above a certain size
        child = (r:Body,dir:number)=>({
          radius: r.radius/2,
          pos:r.pos,
          vel:r.vel.ortho().scale(dir)
        }),
        spawnChildren = (r:Body)=>
                              r.radius >= Constants.StartRockRadius/4 
                              ? [child(r,1), child(r,-1)] : [],
        newRocks = flatMap(collidedRocks, spawnChildren)
          .map((r,i)=>createCircle('rock')(s.objCount + i)(s.time)(r.radius)(r.pos)(r.vel)),

        // search for a body by id in an array
        elem = (a:ReadonlyArray<Body>) => (e:Body) => a.findIndex(b=>b.id === e.id) >= 0,
        // array a except anything in b
        except = (a:ReadonlyArray<Body>) => (b:Body[]) => a.filter(not(elem(b)))
      
      return <State>{
        ...s,
        bullets: except(s.bullets)(collidedBullets),
        rocks: except(s.rocks)(collidedRocks).concat(newRocks),
        exit: s.exit.concat(collidedBullets,collidedRocks),
        objCount: s.objCount + newRocks.length,
        gameOver: shipCollided
      }
    },

    // interval tick: bodies move, bullets expire
    tick = (s:State,elapsed:number) => {
      const 
        expired = (b:Body)=>(elapsed - b.createTime) > 100,
        expiredBullets:Body[] = s.bullets.filter(expired),
        activeBullets = s.bullets.filter(not(expired));
      return handleCollisions({...s, 
        ship:moveBody(s.ship), 
        bullets:activeBullets.map(moveBody), 
        rocks: s.rocks.map(moveBody),
        exit:expiredBullets,
        time:elapsed
      })
    },

    // state transducer
    reduceState = (s:State, e:Rotate|Thrust|Tick|Shoot)=>
      e instanceof Rotate ? {...s,
        ship: {...s.ship,torque:e.direction}
      } :
      e instanceof Thrust ? {...s,
        ship: {...s.ship, acc:e.on?Vec.unitVecInDirection(s.ship.angle).scale(Constants.ThrustAcc):Vec.Zero}
      } :
      e instanceof Shoot ? {...s,
        bullets: s.bullets.concat([
              ((unitVec:Vec)=>
                createCircle('bullet')(s.objCount)(s.time)
                  (Constants.BulletRadius)
                  (s.ship.pos.add(unitVec.scale(s.ship.radius)))
                  (s.ship.vel.add(unitVec.scale(Constants.BulletVelocity))))(Vec.unitVecInDirection(s.ship.angle))]),
        objCount: s.objCount + 1
      } : 
      tick(s,e.elapsed)

  // main game stream
  const subscription =
    merge(gameClock,
      startLeftRotate,startRightRotate,
      stopLeftRotate,stopRightRotate,
      startThrust,stopThrust,
      shoot)
    .pipe(
      scan(reduceState, initialState))
    .subscribe(updateView)

  // Update the svg scene.  
  // This is the only impure function in this program
  function updateView(s: State) {
    const 
      svg = document.getElementById("svgCanvas")!,
      ship = document.getElementById("ship")!,
      show = (id:string,condition:boolean)=>((e:HTMLElement) => 
        condition ? e.classList.remove('hidden')
                  : e.classList.add('hidden'))(document.getElementById(id)!),
      attr = (e:Element,o:Object) =>
        { for(const k in o) e.setAttribute(k,String(o[k])) },
      updateBodyView = (b:Body) => {
        function createBodyView() {
          const v = document.createElementNS(svg.namespaceURI, "ellipse")!;
          attr(v,{id:b.id,rx:b.radius,ry:b.radius});
          v.classList.add(b.viewType)
          svg.appendChild(v)
          return v;
        }
        const v = document.getElementById(b.id) || createBodyView();
        attr(v,{cx:b.pos.x,cy:b.pos.y});
      };
    attr(ship,{transform:`translate(${s.ship.pos.x},${s.ship.pos.y}) rotate(${s.ship.angle})`});
    show("leftThrust",  s.ship.torque<0);
    show("rightThrust", s.ship.torque>0);
    show("thruster",    s.ship.acc.len()>0);
     s.bullets.forEach(updateBodyView);
    s.rocks.forEach(updateBodyView);
    s.exit.map(o=>document.getElementById(o.id))
          .filter(isNotNullOrUndefined)
          .forEach(v=>{
            try {
              svg.removeChild(v)
            } catch(e) {
              // rarely it can happen that a bullet can be in exit 
              // for both expiring and colliding in the same tick,
              // which will cause this exception
              console.log("Already removed: "+v.id)
            }
          })
    if(s.gameOver) {
      subscription.unsubscribe();
      const v = document.createElementNS(svg.namespaceURI, "text")!;
      attr(v,{x:Constants.CanvasSize/6,y:Constants.CanvasSize/2,class:"gameover"});
      v.textContent = "Game Over";
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

setTimeout(showKeys, 0)

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

  static unitVecInDirection = (deg: number) => new Vec(0,-1).rotate(deg)
  static Zero = new Vec();
}

/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T,U>(
  a:ReadonlyArray<T>,
  f:(a:T)=>ReadonlyArray<U>
): ReadonlyArray<U> {
  return Array.prototype.concat(...a.map(f));
}

/**
 * Composable not: invert boolean result of given function
 * @param f a function returning boolean
 */
const not = <T>(f:(x:T)=>boolean)=>(x:T)=>!f(x);

/**
 * Type guard for use in filters
 * @param input something that might be null or undefined
 */
function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
  return input != null;
}
