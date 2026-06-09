const { loadConfig } = require('./config/loadConfig');
const { createTrainingTask, listTrainingTasks } = require('./training-tasks');
const { TrainerAdapter } = require('./learning/trainer');
const { RunStore } = require('./storage/runStore');

const config = loadConfig();
const task = createTrainingTask(config.task);
const store = new RunStore(config);
const trainer = new TrainerAdapter({ config, store, task });

if (!task || !trainer || !store) {
  throw new Error('Smoke wiring failed');
}

console.log('Smoke check ok');
console.log(`task=${task.id} availableTasks=${listTrainingTasks().join(',')}`);
console.log(`agents=${config.run.agentCount} networks=${config.learning.populationSize} generations=${config.run.generations} episodeMs=${config.run.episodeMs}`);
console.log(`server=${config.minecraft.host}:${config.minecraft.port} rcon=${config.rcon.host}:${config.rcon.port}`);
