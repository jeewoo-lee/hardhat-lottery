const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle", function () {
      let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
      const chainId = network.config.chainId

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        await deployments.fixture(["all"])
        raffle = await ethers.getContract("Raffle", deployer)
        // vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
        raffleEntranceFee = await raffle.getEntranceFee()
        interval = await raffle.getInterval()
      })

      describe("constructor", () => {
        it("initalizes the raffle correctly", async function () {
          const raffleState = await raffle.getRaffleState()

          assert.equal(raffleState.toString(), "0")
          assert.equal(interval.toString(), networkConfig[chainId].interval)
        })
      })

      describe("enterRaffle", () => {
        it("reverts when you don't pay enough", async function () {
          await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughEth")
        })

        it("records players when they enter", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          const playerFromContract = await raffle.getPlayer(0)
          assert.equal(playerFromContract, deployer)
        })

        it("emits event on enter", async () => {
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
            raffle,
            "RaffleEnter"
          )
        })

        it("doesn't allow entrance when raffle is calculating", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          // We pretend to be a Chainlink keeper
          await raffle.performUpkeep([])
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
            "Raffle__NotOpen"
          )
        })
      })

      describe("checkUpkeep", () => {
        it("returns false if people haven't send any ETH", async () => {
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          // call static
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upkeepNeeded)
        })

        it("returns false if raffle isn't open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          await raffle.performUpkeep("0x") // can be []
          const raffleState = await raffle.getRaffleState()
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert.equal(raffleState.toString(), "1")
          assert.equal(upkeepNeeded, false)
        })

        it("returns false if enough time hasn't passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
          await network.provider.request({ method: "evm_mine", params: [] })
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
          assert(!upkeepNeeded)
        })

        it("returns true if enough time has passed, has players, eth, and is open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.request({ method: "evm_mine", params: [] })
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
          assert(upkeepNeeded)
        })
      })

      describe("performUpkeep", () => {
        it("it can only run if checkupkeep is true", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          const tx = await raffle.performUpkeep([])
          assert(tx)
        })

        it("reverts when checkupkeep is false", async function () {
          await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpkeepNotNeeded")
        })

        it("updates the raffle state, emits an event, and calls the vrf coordinator", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          const txResponse = await raffle.performUpkeep([])
          const txReceipt = await txResponse.wait(1)
          const requestId = txReceipt.events[1].args.requestID
          console.log(txReceipt.events[1])
          console.log(txReceipt.args)
          const raffleState = await raffle.getRaffleState()
          assert(requestId.toNumber() > 0)
          assert(raffleState.toString() == "1")
        })
      })

      describe("fulfillRandomWords", () => {
        beforeEach(async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
        })
        it("can only be called after performUpKeep", async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
          ).to.be.revertedWith("nonexistent request")
        })
        it("can only be called after performUpKeep", async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith("nonexistent request")
        })
        // it("picks a winner, resets the lottery, and sends money", async () => {
        //   const additionalEntrants = 3
        //   const startingAccountIndex = 1
        //   const accounts = await ethers.getSigners()
        //   for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
        //     const accountConnectedRaffle = raffle.connect(accounts[i])
        //     await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
        //   }
        //   const startingTimeStamp = await raffle.getLatestTimeStamp()

        //   await new Promise(async (resolve, reject) => {
        //     // Promise
        //     raffle.once("WinnerPicked", async () => {
        //       console.log("Found the event!")
        //       try {
        //         const recentWinner = await raffle.getRecentWinner()

        //         console.log(recentWinner.address)
        //         console.log(accounts[0].address)
        //         console.log(accounts[1].address)
        //         console.log(accounts[2].address)
        //         console.log(accounts[3].address)

        //         const raffleState = await raffle.getRaffleState()
        //         const endingTimeStamp = await raffle.getLatestTimeStamp()
        //         const numPlayers = await raffle.getNumberOfPlayers()
        //         assert.equal(numPlayers.toString(), "0")
        //         assert.equal(raffleState.toString(), "0")
        //         assert.equal(endingTimeStamp > startingTimeStamp)
        //       } catch (e) {
        //         reject(e)
        //       }
        //       resolve()
        //     })
        //     // Setting up the listener
        //     // below, it will fire the event, and the listener will pick it up, and resolve
        //     console.log("started?")
        //     const tx = await raffle.performUpkeep("0x")
        //     const txReceipt = await tx.wait(1)
        //     const startingBalance = await accounts[2].getBalance()
        //     console.log("aa")
        //     await vrfCoordinatorV2Mock.fulfillRandomWords(
        //       txReceipt.events[1].args.requestID,
        //       raffle.address
        //     )
        //     console.log("aa")
        //   })
        // })
        it("picks a winner, resets, and sends money", async () => {
          const additionalEntrances = 3
          const startingIndex = 2
          const accounts = await ethers.getSigners()
          for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
            raffle = raffle.connect(accounts[i])
            await raffle.enterRaffle({ value: raffleEntranceFee })
          }
          const startingTimeStamp = await raffle.getLatestTimeStamp()
          // This will be more important for our staging tests...
          await new Promise(async (resolve, reject) => {
              console.log("dsafasjfhjeshieoshfi")
            raffle.once("WinnerPicked", async () => {
              console.log("WinnerPicked event fired!")
              // assert throws an error if it fails, so we need to wrap
              // it in a try/catch so that the promise returns event
              // if it fails.
              try {
                // Now lets get the ending values...
                const recentWinner = await raffle.getRecentWinner()
                const raffleState = await raffle.getRaffleState()
                const winnerBalance = await accounts[2].getBalance()
                const endingTimeStamp = await raffle.getLatestTimeStamp()
                await expect(raffle.getPlayer(0)).to.be.reverted
                assert.equal(recentWinner.toString(), accounts[2].address)
                assert.equal(raffleState, 0)
                assert.equal(
                  winnerBalance.toString(),
                  startingBalance
                    .add(raffleEntranceFee.mul(additionalEntrances).add(raffleEntranceFee))
                    .toString()
                )
                assert(endingTimeStamp > startingTimeStamp)
                resolve()
              } catch (e) {
                reject(e)
              }
            })
            // console.log(vrfCoordinatorV2Mock)

            const tx = await raffle.performUpkeep([])
            const txReceipt = await tx.wait(1)
            const startingBalance = await accounts[2].getBalance()
            console.log(txReceipt.events[1].args.requestID, raffle.address)

            await expect(
              vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
            ).to.be.revertedWith("nonexistent request")

            // await vrfCoordinatorV2Mock.fulfillRandomWords(
            //   txReceipt.events[1].args.requestID,
            //   raffle.address
            // )

            console.log("happened")
          })
        })
      })
    })
