import { ethers } from 'ethers';

const useTransfer = () => {
  const transferEth = async (amount: string) => {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const sender = await provider.getSigner();
      const tx = await sender.sendTransaction({
        to: '0x...userAddress...', // replace with user's address
        value: ethers.utils.parseEther(amount),
      });
      await tx.wait();
    } catch (error) {
      console.error(error);
    }
  };

  return { transferEth };
};

export default useTransfer;