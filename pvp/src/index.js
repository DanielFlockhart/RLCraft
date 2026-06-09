const { runEvolution }=require('./evolution');
const { initRcon, closeRcon }=require('./rcon');

(async()=>{
  try{ await initRcon(); await runEvolution(); }
  catch(err){ console.error('Fatal error', err); process.exitCode=1; }
  finally{ await closeRcon(); process.exit(); }
})();

process.on('SIGINT', async()=>{ console.log('\nSIGINT — closing RCON and exiting'); await closeRcon(); process.exit(0); });
