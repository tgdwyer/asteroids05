# asteroids05

[Edit on StackBlitz ⚡️](https://stackblitz.com/edit/asteroids05)

### Collisions
So far the game we have built allows you to hoon around in a space-ship blasting the void with fireballs which is kind of fun, but not very challenging.  The Asteroids game doesn't really become "Asteroids" until you actually have... asteroids.  Also, you should be able to break them up with your blaster and crashing into them should end the game.  Here's a preview:

[![Spaceship flying](AsteroidsComplete.gif)](https://stackblitz.com/edit/asteroids05?file=index.ts)

#### State
We will need to store two new pieces of state: the collection of asteroids (`rocks`) which is another array of `Body`, just like bullets; and also a boolean that will become `true` when the game ends due to collision between the ship and a rock. 
```typescript
  interface State {
    ...
    readonly rocks:ReadonlyArray<Body>,
    readonly gameOver:boolean
  }
```
Our initial state is going to include several rocks from the outside, as follows:
```typescript
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
    }
```
Our `tick` function is more or less the same as above, but it will apply one more transformation to the state that it returns, by applying the following function.  This function checks for collisions between the ship and rocks, and also between bullets and rocks.  
```typescript```
  handleCollisions = (s:State) => {
    const
      bodiesCollided = (a:Body,b:Body) => a.pos.sub(b.pos).len() < a.radius + b.radius,
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
      bullets: s.bullets.filter(b=>!collidedBullets.includes(b)),
      rocks: s.rocks.filter(r=>!collidedRocks.includes(r)).concat(newRocks),
      exit: s.exit.concat(collidedBullets,collidedRocks),
      objCount: s.objCount + newRocks.length,
      gameOver: shipCollided
    }
  };
```
Finally, we need to update `updateView` function.  First, we need to update the visuals for each of the rocks, but these are the same as bullets.  The second, slightly bigger, change, is simply to display the text "Game Over" on `s.gameover` true. 
```typescript
  function updateView(s: State) {
  ...
    s.bullets.forEach(updateBodyView);
    s.rocks.forEach(updateBodyView);
    s.exit.forEach(o=>{
      const v = document.getElementById(o.id);
      if(v) svg.removeChild(v);
    })
    if(s.gameOver) {
      subscription.unsubscribe();
      const v = document.createElementNS(svg.namespaceURI, "text")!;
      attr(v,{x:Constants.CanvasSize/6,y:Constants.CanvasSize/2,class:"gameover"});
      v.textContent = "Game Over";
      svg.appendChild(v);
    }
  }
```
The other thing happening at game over, is the call to `subscription.unsubscribe`.  This `subscription` is the object returned by the subscribe call on our main Observable:
```typescript
  const subscription = interval(10).pipe(
    map(elapsed=>new Tick(elapsed)),
    merge(
      startLeftRotate,startRightRotate,stopLeftRotate,stopRightRotate),
    merge(startThrust,stopThrust),
    merge(shoot),
    scan(reduceState, initialState)
    ).subscribe(updateView);
```
At this point we have more-or-less all the elements of a game.  The implementation above could be extended quite a lot.  For example, we could add score, multiple lives, perhaps some more physics.  But generally, these are just extensions to the framework above: manipulation and then display of additional state.

The key thing is that the observable has allowed us to keep well separated state management (model), its input and manipulation (control) and the visuals (view).  Further extensions are just additions within each of these elements - and doing so should not add greatly to the complexity.

I invite you to click through on the animations above, to the live code editor where you can extend or refine the framework I've started. 