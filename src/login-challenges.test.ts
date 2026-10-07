import { expect, test } from 'bun:test';
import { LoginChallenges } from './login-challenges';
const auth = {username:'qa',passwordHash:'fixture-hash',totpSecret:'fixture-factor'};

test('password proofs are opaque and bound to their source', () => {
  const challenges=new LoginChallenges(); const id=challenges.issue(auth,'source-one');
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  expect(challenges.get(id,auth,'source-two')).toBeNull();
  expect(challenges.get(id,auth,'source-one')).toBe('qa');
  expect(challenges.get({},auth,'source-one')).toBeNull();
});
test('a password proof expires at its deadline and cannot be replayed after consumption', () => {
  let now=10; const challenges=new LoginChallenges(()=>now,100);
  const expired=challenges.issue(auth,'source');now=110;
  expect(challenges.get(expired,auth,'source')).toBeNull();
  const used=challenges.issue(auth,'source');challenges.consume(used);
  expect(challenges.get(used,auth,'source')).toBeNull();
});
test('changing username, password or factor invalidates a pending login', () => {
  for(const changed of [{...auth,username:'other'},{...auth,passwordHash:'new'},{...auth,totpSecret:'new'},{...auth,totpSecret:undefined}]){
    const challenges=new LoginChallenges();const id=challenges.issue(auth,'source');
    expect(challenges.get(id,changed,'source')).toBeNull();
    expect(challenges.get(id,auth,'source')).toBeNull();
  }
});
test('wrong codes can be retried but five failures invalidate the proof', () => {
  const challenges=new LoginChallenges();const id=challenges.issue(auth,'source');
  for(let i=0;i<4;i++){challenges.fail(id);expect(challenges.get(id,auth,'source')).toBe('qa');}
  challenges.fail(id);expect(challenges.get(id,auth,'source')).toBeNull();
});
test('pending password proofs have a bounded registry and expired entries are pruned', () => {
  let now=0;const challenges=new LoginChallenges(()=>now,100,2);
  const first=challenges.issue(auth,'source');challenges.issue(auth,'source');challenges.issue(auth,'source');
  expect(challenges.get(first,auth,'source')).toBeNull();
  now=100;const fresh=challenges.issue(auth,'source');
  expect(challenges.get(fresh,auth,'source')).toBe('qa');
});
