class solution:
    def findMaxMinRuntime(self, numAPIs, runtimes, numApps):
        low = 0
        high = sum(runtimes)
        
        ans = 0
        while low <= high:
            mid = (low + high) // 2
            if mid == 0:
                low = 1
                continue
                
            total_provided = sum(min(r, mid) for r in runtimes)
            
            if total_provided >= mid * numApps:
                ans = mid
                low = mid + 1
            else:
                high = mid - 1
        return ans
