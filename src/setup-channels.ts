import { PrismaClient } from '@prisma/client';

const channelPairs = [
  {
    discord: "1237942279570722830",
    telegram: "-1002083228885"
  },
  {
    discord: "1283993745699901460",
    telegram: "-1002232075230"
  },
  {
    discord: "1286062013600108604",
    telegram: "-1002167361042"
  },
  {
    discord: "1315054767441186834",
    telegram: "-1002353782569"
  },
  {
    discord: "1191913334115680387",
    telegram: "-1002064349366"
  },
  {
    discord: "1213016976973103124",
    telegram: "-1001956775817"
  },
  {
    discord: "1308249290652647566",
    telegram: "-1002462148523"
  },
  {
    discord: "1239395937785217030",
    telegram: "-1002234774704"
  }
];

async function setupChannels() {
  const prisma = new PrismaClient();

  try {
    console.log('Starting channel pair setup...');

    for (const pair of channelPairs) {
      const bridgeId = `bridge_${Date.now()}_${pair.discord}`;

      // Create Discord channel
      await prisma.channel.create({
        data: {
          platform: 'discord',
          channelId: pair.discord,
          bridgeId: bridgeId,
          name: `discord-${pair.discord}`
        }
      });

      // Create Telegram channel
      await prisma.channel.create({
        data: {
          platform: 'telegram',
          channelId: pair.telegram.trim(), // trim to remove any spaces
          bridgeId: bridgeId,
          name: `telegram-${pair.telegram}`
        }
      });

      console.log(`Created pair: Discord ${pair.discord} <-> Telegram ${pair.telegram}`);
    }

    console.log('All channel pairs created successfully!');
  } catch (error) {
    console.error('Error creating channel pairs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setupChannels();
