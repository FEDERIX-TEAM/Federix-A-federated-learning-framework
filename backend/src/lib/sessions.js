import { newId } from '../../utils/ids.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';

const FAMILY_PREFIX = 'session:family:';

const ROTATE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return -1
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

export const ROTATED = 1;
export const SESSION_ENDED = 0;
export const REUSE_DETECTED = -1;

const familyKey = (fam) => `${FAMILY_PREFIX}${fam}`;

function signRefresh(claims, fam) {
  const jti = newId();
  const token = signRefreshToken({ ...claims, fam, jti });
  const ttl = Math.max(1, verifyRefreshToken(token).exp - Math.floor(Date.now() / 1000));
  return { token, jti, ttl };
}

export function createSessionStore(redis) {
  return {
    async start(claims) {
      const fam = newId();
      const refresh = signRefresh(claims, fam);
      await redis.set(familyKey(fam), refresh.jti, 'EX', refresh.ttl);
      return {
        accessToken: signAccessToken({ ...claims, fam, jti: newId() }),
        refreshToken: refresh.token,
      };
    },

    async rotate(decoded, claims) {
      const refresh = signRefresh(claims, decoded.fam);
      const result = Number(
        await redis.eval(ROTATE_SCRIPT, 1, familyKey(decoded.fam), decoded.jti, refresh.jti, String(refresh.ttl))
      );
      if (result !== ROTATED) return { result };
      return {
        result,
        accessToken: signAccessToken({ ...claims, fam: decoded.fam, jti: newId() }),
        refreshToken: refresh.token,
      };
    },

    async isActive(fam) {
      return Boolean(fam) && (await redis.exists(familyKey(fam))) === 1;
    },

    async end(fam) {
      if (fam) await redis.del(familyKey(fam));
    },
  };
}
