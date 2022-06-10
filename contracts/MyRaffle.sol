// Raffle
// Enter the lottery
// Pick a random winner
// Winner to be selected every X minutes
// Chainlink Oracle -> randomness, automate execution

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

error Raffle__NotEnoughEth();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/** @title A sample Raffle Contract
 *  @author Jeewoo Lee
 *  @notice This contract creates an untamperable decentralized smart contract
 *  @dev This implements Chainlink VRF v2 and keepers
 */

contract MyRaffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
  /* Type Declaration */
  enum RaffleState {
    OPEN,
    CALCULATING
  }

  /* state variables */
  uint256 private immutable i_entranceFee;
  address payable[] private s_players;
  VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
  bytes32 private immutable i_gasLane;
  uint64 private immutable i_subscriptionID;
  uint16 private constant RQUEST_CONFIRMATIONS = 3;
  uint32 private immutable i_callbackGasLimit;
  uint32 private constant NUM_WORDS = 1;

  /* Lotterty Variables */
  address private s_recentWinner;
  RaffleState private s_raffleState;
  uint256 private s_lastTimeStamp;
  uint256 private immutable i_interval;

  /** Events */
  event RaffleEnter(address indexedPlayer);
  event RequestedRaffleWinner(uint256 indexed requestID);
  event WinnerPicked(address indexed winner);

  /** Functions */
  constructor(
    address vrfCoordinatorV2,
    uint256 entranceFee,
    bytes32 gasLane,
    uint64 subscriptionID,
    uint32 callbackGasLimit,
    uint256 interval
  ) VRFConsumerBaseV2(vrfCoordinatorV2) {
    i_entranceFee = entranceFee;
    i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
    i_gasLane = gasLane;
    i_subscriptionID = subscriptionID;
    i_callbackGasLimit = callbackGasLimit;
    s_raffleState = RaffleState.OPEN;
    s_lastTimeStamp = block.timestamp;
    i_interval = interval;
  }

  function enterRaffle() public payable {
    if (msg.value < i_entranceFee) {
      revert Raffle__NotEnoughEth();
    }

    if (s_raffleState != RaffleState.OPEN) {
      revert Raffle__NotOpen();
    }

    s_players.push(payable(msg.sender));
    // Emit an event when we update a dynamic array or mapping
    // Named events with the function name reversed
    emit RaffleEnter(msg.sender);
  }

  /**
   * @dev This is the function that the Chainlink keeper nodes call
   * they look for the 'upkeepNeeded' to return True
   */
  function checkUpkeep(
    bytes memory /*checkData*/
  )
    public
    override
    returns (
      bool upkeepNeeded,
      bytes memory /* performData */
    )
  {
    bool isOpen = RaffleState.OPEN == s_raffleState;
    bool timePassed = (block.timestamp > (s_lastTimeStamp + i_interval));
    bool hasPlayers = (s_players.length > 0);
    bool hasBalance = address(this).balance > 0;
    upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
  }

  function performUpkeep(
    bytes calldata /*performData*/
  ) external override {
    // Request the random number
    // once we get it, do something with it
    // 2 transaction process
    (bool upkeepNeeded, ) = checkUpkeep("");
    if (!upkeepNeeded) {
      revert Raffle__UpkeepNotNeeded(
        address(this).balance,
        s_players.length,
        uint256(s_raffleState)
      );
    }
    s_raffleState = RaffleState.CALCULATING;
    uint256 requestId = i_vrfCoordinator.requestRandomWords(
      i_gasLane,
      i_subscriptionID,
      RQUEST_CONFIRMATIONS,
      i_callbackGasLimit,
      NUM_WORDS
    );
    emit RequestedRaffleWinner(requestId);
  }

  function fulfillRandomWords(
    uint256, /*requestId*/
    uint256[] memory randomWords
  ) internal override {
    uint256 indexOfWinner = randomWords[0] % s_players.length;
    address payable recentWinner = s_players[indexOfWinner];
    s_recentWinner = recentWinner;
    s_raffleState = RaffleState.OPEN;
    s_players = new address payable[](0);
    s_lastTimeStamp = block.timestamp;
    (bool success, ) = recentWinner.call{value: address(this).balance}("");
    if (!success) {
      revert Raffle__TransferFailed();
    }
    emit WinnerPicked(recentWinner);
  }

  /** View / Pure functions */
  function getInterval() external view returns (uint256) {
    return i_interval;
  }

  function getEntranceFee() external view returns (uint256) {
    return i_entranceFee;
  }

  function getPlayer(uint256 index) external view returns (address) {
    return s_players[index];
  }

  function getRecentWinner() external view returns (address) {
    return s_recentWinner;
  }

  function getRaffleState() external view returns (RaffleState) {
    return s_raffleState;
  }

  function getNumWords() external pure returns (uint256) {
    //not view because it's not storage varaible
    return NUM_WORDS;
  }

  function getNumberOfPlayers() external view returns (uint256) {
    return s_players.length;
  }

  function getLatestTimeStamp() external view returns (uint256) {
    return s_lastTimeStamp;
  }

  function getRequestConfirmations() external pure returns (uint256) {
    return RQUEST_CONFIRMATIONS;
  }
}
