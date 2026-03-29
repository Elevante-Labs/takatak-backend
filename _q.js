const { PrismaClient } = require('./node_modules/.prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { id: true, phone: true, role: true, isActive: true } })
  .then(u => { console.log(JSON.stringify(u, null, 2)); return p.$disconnect(); })
  .catch(e => { console.error(e); return p.$disconnect(); });
