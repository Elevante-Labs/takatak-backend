const { PrismaClient } = require('./node_modules/.prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({ 
    select: { id: true, phone: true, role: true, isActive: true, username: true } 
  });
  console.log('All users:', JSON.stringify(users, null, 2));
}

main()
  .then(() => p.$disconnect())
  .catch(e => { console.error(e); return p.$disconnect(); });
