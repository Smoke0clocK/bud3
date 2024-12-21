import { RalphService } from '../services/ralph_service';

const ralphService = new RalphService();

async function testRalph() {
    const contractId = await ralphService.deployContract('mock-payload');
    console.log('Deployed contract ID:', contractId);

    const result = await ralphService.interactWithContract(contractId, 'mock-action');
    console.log('Interaction result:', result);
}

testRalph();
