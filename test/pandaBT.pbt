#Root
	sequence
		// #MOVE_TEST
		// #BEFORE_TEST
		// #BREAK_TEST
		// #IF_TEST
		// #IF_ELSE_TEST
		// #RETRY_TEST
		// #SET_TEST
		// #SHUFFLE_TEST
		#ABORTED_TEST
		#END

tree("END")
	Log "End"

#MOVE_TEST
	MoveTo @_target

#BEFORE_TEST
	before TaskCondition(0.002)
		Log("Before Action")

#BREAK_TEST
	sequence
		Log "BREAK_TEST started"
		repeat 100
			sequence
				retry 10
					sequence
						Succeed
						break 0       // repeat을 종료시킴(0번 째 Index)

#IF_TEST
	if TaskCondition(2.0)
		Log("IfAction")

#IF_ELSE_TEST
	ifelse TaskCondition(2.0)
		Log("ThenAction")
		Log "ElseAction"

#RETRY_TEST
	retry 5
		sequence
			Log("Retry")

#SET_TEST
	sequence
		Set &_target2 @_target		// _target2에 _target 값을 저장
		Set &_destination @_playerPosition

#SHUFFLE_TEST
	shuffle 5 3 4 1 2
		Wait(3.0)
		sequence
			Log("shuffle-1")
		sequence
			Log("shuffle-2")
		sequence
			Log("shuffle-3")
		sequence
			Log("shuffle-4")
		sequence
			Log("shuffle-5")

#ABORTED_TEST
	sequence
		while AbortCondition
			AbortAction